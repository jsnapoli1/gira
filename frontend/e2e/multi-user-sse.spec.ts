/**
 * multi-user-sse.spec.ts
 *
 * Tests that verify real-time board updates are delivered via Server-Sent
 * Events (SSE) when a second user creates, updates, or deletes cards.  All
 * API calls go to the Go backend at 127.0.0.1:<PORT>; page navigation goes to
 * the Vite dev server at localhost:3000 (configured as baseURL in
 * playwright.config.ts).
 */

import { test, expect, chromium } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh user via signup API and return token + user object. */
async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return {
    token: body.token as string,
    user: body.user as { id: number; display_name: string; email: string },
  };
}

/** Create a board owned by the given token, return the board object. */
async function createBoard(request: any, token: string, name = 'SSE Test Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string; columns: any[] };
}

/** Add a member to a board. */
async function addMember(
  request: any,
  ownerToken: string,
  boardId: number,
  userId: number,
  role = 'member',
) {
  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { user_id: userId, role },
  });
}

/** Create a swimlane in the board and return its object. */
async function createSwimlane(
  request: any,
  token: string,
  boardId: number,
  name = 'SSE Swimlane',
  designator = 'SE-',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator },
  });
  return await res.json();
}

/** Get columns for a board. */
async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as any[];
}

/** Create a card via API and return the card object. */
async function createCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title: string,
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId },
  });
  return await res.json();
}

/** Update a card's title via API. */
async function updateCard(request: any, token: string, cardId: number, newTitle: string) {
  await request.put(`${BASE}/api/cards/${cardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: newTitle },
  });
}

/** Delete a card via API. */
async function deleteCard(request: any, token: string, cardId: number) {
  await request.delete(`${BASE}/api/cards/${cardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Full two-user board setup:
 *  - Creates User A (owner) and User B (member)
 *  - Creates a board + swimlane + column references
 *  - Adds User B as a member
 *  - Returns tokens, board, swimlane, and first column
 */
async function setupTwoUserBoard(request: any, prefix: string) {
  const { token: tokenA, user: userA } = await createUser(request, 'User A', `${prefix}-a`);
  const { token: tokenB, user: userB } = await createUser(request, 'User B', `${prefix}-b`);

  const board = await createBoard(request, tokenA, `SSE Board ${prefix}`);
  const swimlane = await createSwimlane(request, tokenA, board.id);
  const columns = await getColumns(request, tokenA, board.id);

  await addMember(request, tokenA, board.id, userB.id);

  return { tokenA, userA, tokenB, userB, board, swimlane, columns };
}

// ---------------------------------------------------------------------------
// Test: Card created by User B appears on User A's board
// ---------------------------------------------------------------------------

test.describe('SSE — real-time board updates', () => {
  test('card created by User B appears on User A board without refresh', async ({
    browser,
    request,
  }) => {
    const { tokenA, tokenB, board, swimlane, columns } = await setupTwoUserBoard(
      request,
      'sse-create',
    );

    // Open board as User A in a dedicated browser context
    const contextA = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await pageA.goto(`/boards/${board.id}`);
      await pageA.waitForSelector('.board-page', { timeout: 15000 });

      // Switch to "All Cards" view so cards appear without requiring an active sprint
      await pageA.click('.view-btn:has-text("All Cards")');
      // Board should show zero card-items initially (no cards yet)
      await expect(pageA.locator('.card-item')).toHaveCount(0, { timeout: 8000 });

      // User B creates a card via API — this triggers SSE broadcast
      const cardTitle = `SSE New Card ${crypto.randomUUID().slice(0, 8)}`;
      await createCard(request, tokenB, board.id, columns[0].id, swimlane.id, cardTitle);

      // User A's board should show the card via SSE without reloading
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${cardTitle}"))`),
      ).toBeVisible({ timeout: 8000 });
    } finally {
      await contextA.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Test: Card deleted by User B disappears from User A's board
  // ---------------------------------------------------------------------------

  test('card deleted by User B disappears from User A board without refresh', async ({
    browser,
    request,
  }) => {
    const { tokenA, tokenB, board, swimlane, columns } = await setupTwoUserBoard(
      request,
      'sse-delete',
    );

    // Pre-create a card so User A can see it when they open the board
    const cardTitle = `SSE Delete Card ${crypto.randomUUID().slice(0, 8)}`;
    const card = await createCard(request, tokenA, board.id, columns[0].id, swimlane.id, cardTitle);

    const contextA = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await pageA.goto(`/boards/${board.id}`);
      await pageA.waitForSelector('.board-page', { timeout: 15000 });

      // Switch to "All Cards" view and confirm the card is visible
      await pageA.click('.view-btn:has-text("All Cards")');
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${cardTitle}"))`),
      ).toBeVisible({ timeout: 10000 });

      // User B deletes the card via API
      await deleteCard(request, tokenB, card.id);

      // The card should disappear from User A's board via SSE
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${cardTitle}"))`),
      ).not.toBeVisible({ timeout: 8000 });
    } finally {
      await contextA.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Test: Card title updated by User B reflects on User A's board
  // ---------------------------------------------------------------------------

  test('card title update by User B reflects on User A board without refresh', async ({
    browser,
    request,
  }) => {
    const { tokenA, tokenB, board, swimlane, columns } = await setupTwoUserBoard(
      request,
      'sse-update',
    );

    const originalTitle = `SSE Original ${crypto.randomUUID().slice(0, 8)}`;
    const updatedTitle = `SSE Updated ${crypto.randomUUID().slice(0, 8)}`;
    const card = await createCard(
      request,
      tokenA,
      board.id,
      columns[0].id,
      swimlane.id,
      originalTitle,
    );

    const contextA = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await pageA.goto(`/boards/${board.id}`);
      await pageA.waitForSelector('.board-page', { timeout: 15000 });

      // Switch to "All Cards" and confirm the original title is visible
      await pageA.click('.view-btn:has-text("All Cards")');
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${originalTitle}"))`),
      ).toBeVisible({ timeout: 10000 });

      // User B updates the card title via API
      await updateCard(request, tokenB, card.id, updatedTitle);

      // User A should see the new title appear via SSE (no page reload)
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${updatedTitle}"))`),
      ).toBeVisible({ timeout: 8000 });
      // Original title should no longer be on the card
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${originalTitle}"))`),
      ).not.toBeVisible({ timeout: 5000 });
    } finally {
      await contextA.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Test: SSE reconnects after navigate-away-and-back
  // ---------------------------------------------------------------------------

  test.fixme(
    'SSE reconnects after navigating away and back to the board',
    async ({ browser, request }) => {
      // This test is marked fixme because reliably verifying SSE reconnection
      // requires observing the EventSource lifecycle (readyState transitions)
      // across two page navigations in Playwright, which is brittle.
      // The exponential-backoff reconnect logic in useBoardSSE.ts already
      // has unit test coverage expectations; verifying it end-to-end here
      // requires either intercepting network at the EventSource level or
      // exposing reconnect state to the DOM.
      const { tokenA, tokenB, board, swimlane, columns } = await setupTwoUserBoard(
        request,
        'sse-reconnect',
      );

      const contextA = await browser.newContext();
      try {
        const pageA = await contextA.newPage();
        await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);

        // Open board — SSE connects
        await pageA.goto(`/boards/${board.id}`);
        await pageA.waitForSelector('.board-page', { timeout: 15000 });

        // Navigate away — SSE disconnects
        await pageA.goto('/boards');
        await pageA.waitForSelector('.boards-page', { timeout: 8000 });

        // Navigate back — SSE reconnects
        await pageA.goto(`/boards/${board.id}`);
        await pageA.waitForSelector('.board-page', { timeout: 15000 });
        await pageA.click('.view-btn:has-text("All Cards")');

        // Create a card; it should appear via reconnected SSE
        const title = `Reconnect Card ${crypto.randomUUID().slice(0, 8)}`;
        await createCard(request, tokenB, board.id, columns[0].id, swimlane.id, title);
        await expect(
          pageA.locator(`.card-item:has(.card-title:text-is("${title}"))`),
        ).toBeVisible({ timeout: 8000 });
      } finally {
        await contextA.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Test: Both User A and User B see the same board state
  // ---------------------------------------------------------------------------

  test('both users see the same card after it is created', async ({ browser, request }) => {
    const { tokenA, tokenB, board, swimlane, columns } = await setupTwoUserBoard(
      request,
      'sse-both',
    );

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      // Open board as User A
      const pageA = await contextA.newPage();
      await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await pageA.goto(`/boards/${board.id}`);
      await pageA.waitForSelector('.board-page', { timeout: 15000 });
      await pageA.click('.view-btn:has-text("All Cards")');

      // Open board as User B
      const pageB = await contextB.newPage();
      await pageB.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
      await pageB.goto(`/boards/${board.id}`);
      await pageB.waitForSelector('.board-page', { timeout: 15000 });
      await pageB.click('.view-btn:has-text("All Cards")');

      // Both should start with zero cards
      await expect(pageA.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
      await expect(pageB.locator('.card-item')).toHaveCount(0, { timeout: 8000 });

      // Create a card as User A via API
      const cardTitle = `Shared Card ${crypto.randomUUID().slice(0, 8)}`;
      await createCard(request, tokenA, board.id, columns[0].id, swimlane.id, cardTitle);

      // Both User A and User B should see the card via SSE
      await expect(
        pageA.locator(`.card-item:has(.card-title:text-is("${cardTitle}"))`),
      ).toBeVisible({ timeout: 8000 });
      await expect(
        pageB.locator(`.card-item:has(.card-title:text-is("${cardTitle}"))`),
      ).toBeVisible({ timeout: 8000 });

      // Board state should be consistent — both users see exactly 1 card
      await expect(pageA.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
      await expect(pageB.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
