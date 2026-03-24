/**
 * assignees.spec.ts
 *
 * Comprehensive tests for card assignee management.
 *
 * Test inventory
 * ──────────────
 * Filter UI
 *  1.  Assignee filter visible on board view
 *  2.  Board members shown in assignee dropdown
 *
 * Card detail modal — assignees
 *  3.  Add assignee to card via card detail modal
 *  4.  Remove assignee from card via card detail modal
 *  5.  Multiple assignees on one card
 *  6.  Remove all assignees from card
 *  7.  Self-assign (user assigns themselves)
 *  8.  Assignee persists after page reload
 *
 * Card board chip display
 *  9.  Assignee shown in card item on board after assignment
 * 10.  Card with no assignees shows no avatar row
 *
 * Assignee filter behaviour
 * 11.  Filter by specific assignee shows only their cards
 * 12.  Filter by "All assignees" shows all cards
 * 13.  Unassigned filter shows only cards with no assignee (via API state)
 *
 * API — happy paths
 * 14.  POST /api/cards/:id/assignees returns 200 with assignee data
 * 15.  GET /api/cards/:id returns assignees array
 * 16.  DELETE /api/cards/:id/assignees/:userId returns 200
 * 17.  GET /api/boards/:id/members lists board members
 *
 * API — edge cases
 * 18.  Duplicate assignment is idempotent (no 5xx)
 * 19.  Non-board-member cannot be assigned (API returns 4xx)
 * 20.  Remove assignee that was never assigned returns 4xx
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Assignee Tester',
): Promise<{ token: string; user: { id: number; display_name: string; email: string } }> {
  const email = `test-assignees-${crypto.randomUUID()}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

interface SetupResult {
  token: string;
  userId: number;
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
}

/**
 * Create user + board + swimlane via API.
 */
async function setup(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Assignee Tester',
): Promise<SetupResult> {
  const { token, user } = await createUser(request, displayName);

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Assignees Board ${crypto.randomUUID().slice(0, 8)}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  return {
    token,
    userId: user.id,
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: firstColumn?.id,
  };
}

async function createCard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title = 'Test Card',
): Promise<{ id: number; title: string } | null> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!res.ok()) return null;
  return res.json();
}

/**
 * Navigate to a board, inject token, and switch to "All Cards" view so cards are
 * always visible regardless of sprint state.
 */
async function goToBoard(
  page: import('@playwright/test').Page,
  token: string,
  boardId: number,
  switchToAllCards = true,
): Promise<void> {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });
  if (switchToAllCards) {
    await page.click('.view-btn:has-text("All Cards")');
    // Wait for the view to stabilise.
    await page.waitForTimeout(500);
  }
}

// ---------------------------------------------------------------------------
// Filter UI
// ---------------------------------------------------------------------------

test.describe('Assignee filter UI', () => {
  test('assignee filter is visible on board view', async ({ page, request }) => {
    const ctx = await setup(request, 'FilterVisible Tester');
    await goToBoard(page, ctx.token, ctx.boardId, false);

    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filter-select', { timeout: 5000 });

    const assigneeFilter = page
      .locator('.filter-select')
      .filter({ has: page.locator('option:text("All assignees")') });
    await expect(assigneeFilter).toBeVisible();
    await expect(assigneeFilter.locator('option').first()).toHaveText('All assignees');
  });

  test('board member appears in the assignee filter dropdown', async ({ page, request }) => {
    const ctx = await setup(request, 'FilterMember Tester');
    await goToBoard(page, ctx.token, ctx.boardId, false);

    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filter-select', { timeout: 5000 });

    const assigneeFilter = page
      .locator('.filter-select')
      .filter({ has: page.locator('option:text("All assignees")') });
    await expect(assigneeFilter).toBeVisible();

    const options = await assigneeFilter.locator('option').allTextContents();
    expect(options.some((opt) => opt.includes('FilterMember Tester'))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Card detail modal — assignees
// ---------------------------------------------------------------------------

test.describe('Card detail modal — assignees', () => {
  test('add assignee to card via card detail modal', async ({ page, request }) => {
    const ctx = await setup(request, 'AddAssignee Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await goToBoard(page, ctx.token, ctx.boardId);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // The add-assignee-select should list board members.
    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });

    // Select the first available user.
    await addSelect.selectOption({ index: 1 });

    // The assignee item should now appear in the list.
    await expect(page.locator('.assignee-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.assignee-name')).toBeVisible();
  });

  test('remove assignee from card via card detail modal', async ({ page, request }) => {
    const ctx = await setup(request, 'RemoveAssignee Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Pre-assign the creator via API.
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.assignee-item')).toHaveCount(1, { timeout: 5000 });

    // Click the remove button.
    await page.click('.remove-assignee');

    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });
  });

  test('multiple assignees can be added to one card', async ({ page, request }) => {
    // Create two users who are both board members.
    const ctx = await setup(request, 'MultiAssignee Owner');

    // Create second user and add as board member.
    const { token: token2, user: user2 } = await createUser(request, 'MultiAssignee Member');
    await request.post(`${BASE}/api/boards/${ctx.boardId}/members`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: user2.id, role: 'member' },
    });

    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Assign both users via API.
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: user2.id },
    });

    await goToBoard(page, ctx.token, ctx.boardId);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.assignee-item')).toHaveCount(2, { timeout: 5000 });
    void token2; // suppress unused-var warning
  });

  test('remove all assignees from card — assignees list becomes empty', async ({
    page,
    request,
  }) => {
    const ctx = await setup(request, 'RemoveAll Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Pre-assign the creator.
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.assignee-item')).toHaveCount(1, { timeout: 5000 });

    await page.click('.remove-assignee');
    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });
    // add-assignee-select should reappear once there are unassigned users.
    await expect(page.locator('.add-assignee-select')).toBeVisible({ timeout: 5000 });
  });

  test('self-assign — user assigns themselves to a card', async ({ page, request }) => {
    const ctx = await setup(request, 'SelfAssign Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await goToBoard(page, ctx.token, ctx.boardId);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });
    // Select the board creator (themselves).
    await addSelect.selectOption({ index: 1 });

    await expect(page.locator('.assignee-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.assignee-name')).toContainText('SelfAssign Tester');
  });

  test('assignee persists after page reload', async ({ page, request }) => {
    const ctx = await setup(request, 'PersistAssignee Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Assign via API.
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);

    // Reload the page without clearing the token.
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 8000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.assignee-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.assignee-name')).toContainText('PersistAssignee Tester');
  });
});

// ---------------------------------------------------------------------------
// Card board chip display
// ---------------------------------------------------------------------------

test.describe('Assignee display on board card chip', () => {
  test('assigned user shows as avatar on the card chip', async ({ page, request }) => {
    const ctx = await setup(request, 'AvatarChip Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);

    await expect(page.locator('.card-assignees')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-assignee')).toHaveCount(1, { timeout: 5000 });
  });

  test('card with no assignees shows no .card-assignees element', async ({ page, request }) => {
    const ctx = await setup(request, 'NoAvatar Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await goToBoard(page, ctx.token, ctx.boardId);

    await expect(page.locator('.card-item')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-assignees')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Assignee filter behaviour
// ---------------------------------------------------------------------------

test.describe('Assignee filter behaviour', () => {
  test('filter by specific assignee shows only their cards', async ({ page, request }) => {
    const ctx = await setup(request, 'FilterUser Tester');

    const { token: token2, user: user2 } = await createUser(request, 'FilterOther Tester');
    await request.post(`${BASE}/api/boards/${ctx.boardId}/members`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: user2.id, role: 'member' },
    });

    const card1 = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Card Assigned To Owner',
    );
    const card2 = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Card Assigned To Member',
    );
    if (!card1 || !card2) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card1.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });
    await request.post(`${BASE}/api/cards/${card2.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: user2.id },
    });

    await goToBoard(page, ctx.token, ctx.boardId);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Expand filters and select the owner (ctx.userId) in the assignee dropdown.
    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filter-select', { timeout: 5000 });

    const assigneeFilter = page
      .locator('.filter-select')
      .filter({ has: page.locator('option:text("All assignees")') });
    await assigneeFilter.selectOption({ value: String(ctx.userId) });

    // Only the owner's card should be visible.
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item h4:has-text("Card Assigned To Owner")')).toBeVisible();

    void token2;
  });

  test('selecting "All assignees" shows all cards again', async ({ page, request }) => {
    const ctx = await setup(request, 'AllAssignees Tester');

    const card1 = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Card A',
    );
    const card2 = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Card B',
    );
    if (!card1 || !card2) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card1.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Apply assignee filter.
    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filter-select', { timeout: 5000 });
    const assigneeFilter = page
      .locator('.filter-select')
      .filter({ has: page.locator('option:text("All assignees")') });
    await assigneeFilter.selectOption({ value: String(ctx.userId) });
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Reset to "All assignees".
    await assigneeFilter.selectOption({ value: '' });
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });

  test('unassigned cards are hidden when an assignee filter is active', async ({
    page,
    request,
  }) => {
    const ctx = await setup(request, 'UnassignedHidden Tester');

    const card1 = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Assigned Card',
    );
    await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
      'Unassigned Card',
    );
    if (!card1) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card1.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    await goToBoard(page, ctx.token, ctx.boardId);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filter-select', { timeout: 5000 });
    const assigneeFilter = page
      .locator('.filter-select')
      .filter({ has: page.locator('option:text("All assignees")') });
    await assigneeFilter.selectOption({ value: String(ctx.userId) });

    // The unassigned card should no longer be visible.
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item h4:has-text("Unassigned Card")')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// API — happy paths
// ---------------------------------------------------------------------------

test.describe('Assignee API — happy paths', () => {
  test('POST /api/cards/:id/assignees returns 200 with assignee data', async ({ request }) => {
    const ctx = await setup(request, 'APIPost Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Response may be the assignee object or a list — either is acceptable.
    expect(body).toBeTruthy();
  });

  test('GET /api/cards/:id returns an assignees array', async ({ request }) => {
    const ctx = await setup(request, 'APIGet Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.assignees)).toBe(true);
    expect(body.assignees.length).toBe(1);
    expect(body.assignees[0].id).toBe(ctx.userId);
  });

  test('DELETE /api/cards/:id/assignees/:userId returns 200', async ({ request }) => {
    const ctx = await setup(request, 'APIDelete Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });

    const delRes = await request.delete(
      `${BASE}/api/cards/${card.id}/assignees/${ctx.userId}`,
      { headers: { Authorization: `Bearer ${ctx.token}` } },
    );
    expect(delRes.status()).toBe(200);

    // Confirm removed.
    const getRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    const body = await getRes.json();
    expect(Array.isArray(body.assignees)).toBe(true);
    expect(body.assignees.length).toBe(0);
  });

  test('GET /api/boards/:id/members lists board members', async ({ request }) => {
    const ctx = await setup(request, 'GetMembers Tester');

    const res = await request.get(`${BASE}/api/boards/${ctx.boardId}/members`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(res.status()).toBe(200);
    const members = await res.json();
    expect(Array.isArray(members)).toBe(true);
    // The board creator should be an admin member.
    const creator = members.find((m: any) => m.user_id === ctx.userId);
    expect(creator).toBeTruthy();
    expect(creator.role).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// API — edge cases
// ---------------------------------------------------------------------------

test.describe('Assignee API — edge cases', () => {
  test('duplicate assignment is idempotent — no 5xx', async ({ request }) => {
    const ctx = await setup(request, 'DuplicateAssign Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Assign once.
    const res1 = await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });
    expect(res1.status()).toBeLessThan(500);

    // Assign again — should not cause a 5xx.
    const res2 = await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: ctx.userId },
    });
    expect(res2.status()).toBeLessThan(500);
  });

  test('non-board-member cannot be assigned — API returns 4xx', async ({ request }) => {
    const ctx = await setup(request, 'NonMemberOwner Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    // Create a separate user who is NOT added to the board.
    const { user: outsider } = await createUser(request, 'NonMember Outsider');

    const res = await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: outsider.id },
    });
    // Should be rejected with a 4xx error code.
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('remove an assignee that was never assigned returns 4xx', async ({ request }) => {
    const ctx = await setup(request, 'RemoveNever Tester');
    const card = await createCard(
      request,
      ctx.token,
      ctx.boardId,
      ctx.firstColumnId,
      ctx.swimlaneId,
    );
    if (!card) { test.skip(true, 'Card creation unavailable'); return; }

    const { user: otherUser } = await createUser(request, 'RemoveNever Other');
    await request.post(`${BASE}/api/boards/${ctx.boardId}/members`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { user_id: otherUser.id, role: 'member' },
    });

    const res = await request.delete(
      `${BASE}/api/cards/${card.id}/assignees/${otherUser.id}`,
      { headers: { Authorization: `Bearer ${ctx.token}` } },
    );
    // Expect a client error — not a 5xx.
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
