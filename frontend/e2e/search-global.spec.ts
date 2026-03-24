/**
 * Global / cross-board search tests
 *
 * Investigation findings (2026-03-24):
 *   - GET /api/cards/search requires `board_id` — it is scoped to a single board.
 *   - There is no /api/search (or similar) endpoint that searches across boards.
 *   - The frontend has no global search UI; the search input lives inside
 *     BoardView.tsx and is only rendered while viewing a specific board.
 *   - Layout.tsx keyboard shortcut "/" focuses the per-board search input —
 *     not a global search.
 *
 * Per-board search is already covered in card-search.spec.ts.
 * All UI tests below are marked fixme until global search is implemented.
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sign up a fresh user and return their token. */
async function createUser(request: any) {
  const email = `global-search-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Global Search Tester' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

/** Create a board and return its id + default columns. */
async function createBoard(request: any, token: string, name: string) {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    })
  ).json();

  return { board, columns, swimlane };
}

/** Create a card and return it. */
async function createCard(
  request: any,
  token: string,
  opts: { title: string; description?: string; boardId: number; columnId: number; swimlaneId: number }
) {
  return (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: opts.title,
        description: opts.description ?? '',
        column_id: opts.columnId,
        swimlane_id: opts.swimlaneId,
        board_id: opts.boardId,
      },
    })
  ).json();
}

// ---------------------------------------------------------------------------
// UI tests — all fixme because global search is not implemented
// ---------------------------------------------------------------------------

test.describe('Global Search UI (not yet implemented)', () => {
  test.fixme(
    true,
    'No global search implemented — no cross-board search input exists in the navigation/header'
  );

  test('global search box is visible in the navigation header', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('[data-testid="global-search"], .global-search-input')).toBeVisible({
      timeout: 10000,
    });
  });

  test('search finds a card by exact title across boards', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    const { board, columns, swimlane } = await createBoard(request, token, 'Board A');
    await createCard(request, token, {
      title: 'Unique Card Exact Title',
      boardId: board.id,
      columnId: columns[0].id,
      swimlaneId: swimlane.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('Unique Card Exact Title');

    await expect(page.locator('text=Unique Card Exact Title')).toBeVisible({ timeout: 8000 });
  });

  test('search finds a card by partial title', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    const { board, columns, swimlane } = await createBoard(request, token, 'Board Partial');
    await createCard(request, token, {
      title: 'Partial Title Match Card',
      boardId: board.id,
      columnId: columns[0].id,
      swimlaneId: swimlane.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('Partial Title');

    await expect(page.locator('text=Partial Title Match Card')).toBeVisible({ timeout: 8000 });
  });

  test('search is case-insensitive', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    const { board, columns, swimlane } = await createBoard(request, token, 'Board Case');
    await createCard(request, token, {
      title: 'CaseSensitivity Test Card',
      boardId: board.id,
      columnId: columns[0].id,
      swimlaneId: swimlane.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('casesensitivity test');

    await expect(page.locator('text=CaseSensitivity Test Card')).toBeVisible({ timeout: 8000 });
  });

  test('search finds cards across multiple boards', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);

    const { board: boardA, columns: colsA, swimlane: laneA } = await createBoard(request, token, 'Cross Board A');
    const { board: boardB, columns: colsB, swimlane: laneB } = await createBoard(request, token, 'Cross Board B');

    await createCard(request, token, {
      title: 'CrossBoard Card Alpha',
      boardId: boardA.id,
      columnId: colsA[0].id,
      swimlaneId: laneA.id,
    });
    await createCard(request, token, {
      title: 'CrossBoard Card Beta',
      boardId: boardB.id,
      columnId: colsB[0].id,
      swimlaneId: laneB.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('CrossBoard Card');

    await expect(page.locator('text=CrossBoard Card Alpha')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=CrossBoard Card Beta')).toBeVisible({ timeout: 8000 });
  });

  test('search result links navigate to the correct board and card', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    const { board, columns, swimlane } = await createBoard(request, token, 'Link Board');
    const card = await createCard(request, token, {
      title: 'Navigate To This Card',
      boardId: board.id,
      columnId: columns[0].id,
      swimlaneId: swimlane.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('Navigate To This Card');

    const resultLink = page.locator(`[data-card-id="${card.id}"], a:has-text("Navigate To This Card")`).first();
    await resultLink.click();

    await page.waitForURL(`**/boards/${board.id}**`, { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`));
  });

  test('empty search shows no results or clears the result list', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('   ');

    // Either no result items or the result panel should not exist
    const resultItems = page.locator('[data-testid="global-search-result"], .global-search-result');
    await expect(resultItems).toHaveCount(0, { timeout: 5000 });
  });

  test('search finds a card by description text', async ({ page, request }) => {
    // no global search implemented
    const { token } = await createUser(request);
    const { board, columns, swimlane } = await createBoard(request, token, 'Desc Search Board');
    await createCard(request, token, {
      title: 'Card With Unique Description',
      description: 'xyzzy-unique-description-token',
      boardId: board.id,
      columnId: columns[0].id,
      swimlaneId: swimlane.id,
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const searchInput = page.locator('[data-testid="global-search"], .global-search-input');
    await searchInput.fill('xyzzy-unique-description-token');

    await expect(page.locator('text=Card With Unique Description')).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// API-level tests — document current backend behaviour
// ---------------------------------------------------------------------------

test.describe('Global Search API', () => {
  /**
   * The existing /api/cards/search endpoint is per-board — board_id is required.
   * This test documents that behaviour and verifies a cross-board call (no
   * board_id) correctly returns 400 Bad Request.
   */
  test('GET /api/cards/search without board_id returns 400', async ({ request }) => {
    const { token } = await createUser(request);

    const res = await request.get(`${BASE}/api/cards/search?q=anything`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(400);
  });

  /**
   * Per-board search returns cards matching the query within one board.
   * This test is here to contrast with what a global search would need to do:
   * the same query against a second board returns independent results.
   */
  test('GET /api/cards/search with board_id is scoped to that board only', async ({ request }) => {
    const { token } = await createUser(request);

    // Board 1 — contains the matching card
    const { board: board1, columns: cols1, swimlane: lane1 } = await createBoard(
      request,
      token,
      'Scoped Search Board 1'
    );
    await createCard(request, token, {
      title: 'SharedTitleToken Card',
      boardId: board1.id,
      columnId: cols1[0].id,
      swimlaneId: lane1.id,
    });

    // Board 2 — does NOT contain the matching card
    const { board: board2 } = await createBoard(request, token, 'Scoped Search Board 2');

    // Searching board1 finds the card
    const res1 = await request.get(
      `${BASE}/api/cards/search?q=SharedTitleToken&board_id=${board1.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();
    expect(Array.isArray(body1.cards)).toBe(true);
    expect(body1.cards.some((c: any) => c.title === 'SharedTitleToken Card')).toBe(true);

    // Searching board2 does NOT find the card (it belongs to board1)
    const res2 = await request.get(
      `${BASE}/api/cards/search?q=SharedTitleToken&board_id=${board2.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(Array.isArray(body2.cards)).toBe(true);
    expect(body2.cards.some((c: any) => c.title === 'SharedTitleToken Card')).toBe(false);
  });
});
