/**
 * search-advanced.spec.ts — Advanced search and filter E2E tests
 *
 * Coverage (40+ tests):
 *   1.  Global search — UI presence & behaviour (1–11)
 *   2.  Board-level filter bar (12–21)
 *   3.  Saved filters — UI + API (22–31)
 *   4.  Backlog search / filter (32–36)
 *   5.  Reports search / board selector (37–39)
 *   6.  Card search within a board (40–43)
 *   7.  API search endpoint (44–50)
 *
 * UI features not yet implemented are marked `test.fixme`.
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ===========================================================================
// Helpers
// ===========================================================================

interface BoardSetup {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardsCreated: boolean;
}

async function createUser(request: any, displayName = 'Adv Search Tester'): Promise<{ token: string }> {
  const email = `adv-search-${crypto.randomUUID()}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function createBoard(request: any, token: string, name: string): Promise<{ id: number }> {
  return (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
    })
  ).json();
}

async function getColumns(
  request: any,
  token: string,
  boardId: number,
): Promise<Array<{ id: number; name: string; state: string; position: number }>> {
  return (
    await request.get(`${BASE}/api/boards/${boardId}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
}

async function createSwimlane(request: any, token: string, boardId: number): Promise<{ id: number }> {
  return (
    await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();
}

async function createCard(
  request: any,
  token: string,
  opts: {
    title: string;
    description?: string;
    boardId: number;
    columnId: number;
    swimlaneId: number;
    priority?: string;
  },
): Promise<{ id: number } | null> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: opts.title,
      description: opts.description ?? '',
      column_id: opts.columnId,
      swimlane_id: opts.swimlaneId,
      board_id: opts.boardId,
      priority: opts.priority ?? 'medium',
    },
  });
  if (!res.ok()) return null;
  return res.json();
}

/**
 * Full board setup with 3 cards (high / low / medium priority).
 * cardsCreated=false means Gitea returned 401 during card POST.
 */
async function setupFilterBoard(request: any): Promise<BoardSetup> {
  const { token } = await createUser(request);
  const board = await createBoard(request, token, `Filter Board ${Date.now()}`);
  const cols = await getColumns(request, token, board.id);
  const sortedCols = [...cols].sort((a, b) => a.position - b.position);
  const columnId = sortedCols[0].id;
  const { id: swimlaneId } = await createSwimlane(request, token, board.id);

  const c1 = await createCard(request, token, {
    title: 'High Priority Card',
    boardId: board.id,
    columnId,
    swimlaneId,
    priority: 'high',
  });
  if (!c1) {
    return { token, boardId: board.id, columnId, swimlaneId, cardsCreated: false };
  }
  await createCard(request, token, {
    title: 'Low Priority Card',
    boardId: board.id,
    columnId,
    swimlaneId,
    priority: 'low',
  });
  await createCard(request, token, {
    title: 'Normal Card',
    description: 'description for search testing purposes',
    boardId: board.id,
    columnId,
    swimlaneId,
    priority: 'medium',
  });
  return { token, boardId: board.id, columnId, swimlaneId, cardsCreated: true };
}

/** Navigate to a board and switch to All Cards view. */
async function navigateToBoard(
  page: any,
  token: string,
  boardId: number,
  switchToAllCards = true,
) {
  await page.addInitScript((t: string) => {
    localStorage.setItem('token', t);
    localStorage.removeItem('zira-filters-expanded');
  }, token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 15000 });
  if (switchToAllCards) {
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });
  }
}

/** Navigate to the board's backlog tab. */
async function navigateToBacklog(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-view', { timeout: 8000 });
}

/** Expand filter bar and select a priority. */
async function setActivePriorityFilter(page: any, priority: string) {
  if (!(await page.locator('.filters-expanded').isVisible())) {
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
  }
  const prioritySelect = page.locator('.filter-select').filter({
    has: page.locator('option:text("All priorities")'),
  });
  await prioritySelect.selectOption(priority);
}

/** Save the current filter set with the given name via the save-filter UI. */
async function saveFilter(page: any, name: string) {
  const saveBtn = page.locator('.save-filter-btn');
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();
  await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
  await page.locator('.save-filter-input').fill(name);
  await page.click('.save-filter-modal .btn-primary');
  await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });
}

// ===========================================================================
// 1 — Global Search
// ===========================================================================

test.describe('Global Search', () => {
  test.setTimeout(90000);

  // Test 1
  test('search bar is visible on the board page', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Search Visible ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await expect(page.locator('.search-input input')).toBeVisible();
    await expect(page.locator('.search-input input')).toHaveAttribute('placeholder', /search/i);
  });

  // Test 2
  test('search by card title finds the correct card', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.locator('.search-input input').fill('High Priority Card');

    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Low Priority Card"]')).not.toBeVisible();
    await expect(page.locator('.card-item[aria-label="Normal Card"]')).not.toBeVisible();
  });

  // Test 3
  test('partial title search matches all cards containing the term', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.locator('.search-input input').fill('Priority');

    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Low Priority Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Normal Card"]')).not.toBeVisible();
  });

  // Test 4
  test('search with no results shows empty state (zero cards visible)', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.locator('.search-input input').fill('ZZZNO_MATCH_XYZ');

    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  // Test 5
  test('pressing Escape clears the search input', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Escape Clear ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('something');
    await expect(searchInput).toHaveValue('something');

    await searchInput.press('Escape');

    await expect(searchInput).toHaveValue('');
  });

  // Test 6
  test('clicking a search result card opens its detail modal', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.locator('.search-input input').fill('High Priority Card');
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 8000 });

    await page.locator('.card-item[aria-label="High Priority Card"]').click();
    await expect(page.locator('.card-detail-modal, .modal-overlay')).toBeVisible({ timeout: 8000 });
  });

  // Test 7 — fixme: global cross-board search not implemented
  test.fixme('global search finds cards from multiple boards', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.boards-list, .board-card', { timeout: 10000 });
    await expect(page.locator('.global-search-input input')).toBeVisible();
  });

  // Test 8
  test('search is case-insensitive', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    // Lowercase should still find the card
    await page.locator('.search-input input').fill('high priority card');

    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Low Priority Card"]')).not.toBeVisible();
  });

  // Test 9
  test('search by card description text finds matching card', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    // "Normal Card" has description containing 'description for search testing purposes'
    await page.locator('.search-input input').fill('description for search testing');

    await expect(page.locator('.card-item[aria-label="Normal Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).not.toBeVisible();
  });

  // Test 10
  test('search with special characters does not crash the board page', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Special Chars ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill("' OR 1=1; -- & < > \"");

    // Board page must remain intact — no crash
    await expect(page.locator('.board-header')).toBeVisible();
  });

  // Test 11 — fixme: global search bar on /boards not yet built
  test.fixme('global search bar is visible on the /boards dashboard', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.boards-list, .board-card', { timeout: 10000 });
    await expect(page.locator('.global-search-input, [data-testid="global-search"]')).toBeVisible();
  });
});

// ===========================================================================
// 2 — Board-Level Filters
// ===========================================================================

test.describe('Board-Level Filters', () => {
  test.setTimeout(90000);

  // Test 12
  test('filter cards by assignee shows only assigned cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    if (!meRes.ok()) { test.skip(true, 'Cannot fetch current user'); return; }
    const me = await meRes.json();

    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    if (!boardCards.length) { test.skip(true, 'No cards found'); return; }
    await request.post(`${BASE}/api/cards/${boardCards[0].id}/assignees`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { user_id: me.id },
    });

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const assigneeSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });
    await assigneeSelect.selectOption(String(me.id));

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  // Test 13
  test('filter cards by label shows only labelled cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'urgent', color: '#ef4444' },
    });
    if (!labelRes.ok()) { test.skip(true, 'Label creation unavailable'); return; }
    const label = await labelRes.json();

    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    await request.post(`${BASE}/api/cards/${boardCards[0].id}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { label_id: label.id },
    });

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await labelSelect.selectOption(String(label.id));

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  // Test 14
  test('filter cards by priority shows only matching-priority cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible();
  });

  // Test 15
  test('filter cards by due date (overdue) shows only overdue cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    // Create an extra card and mark it overdue
    const overdueRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Overdue Task',
        column_id: setup.columnId,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!overdueRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const overdueCard = await overdueRes.json();
    await request.put(`${BASE}/api/cards/${overdueCard.id}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { title: overdueCard.title, description: '', due_date: '2020-01-01' },
    });

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
    await page.locator('.filter-overdue').click();

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Overdue Task"]')).toBeVisible();
  });

  // Test 16
  test('filter cards by sprint shows only cards in that sprint', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${setup.boardId}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Sprint Alpha' },
    });
    if (!sprintRes.ok()) { test.skip(true, 'Sprint creation unavailable'); return; }
    const sprint = await sprintRes.json();

    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    await request.put(`${BASE}/api/cards/${boardCards[0].id}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { title: boardCards[0].title, description: boardCards[0].description ?? '', sprint_id: sprint.id },
    });

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const sprintSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All sprints")'),
    });
    const sprintOptions = await sprintSelect.locator('option').allTextContents();
    const sprintOption = sprintOptions.find((o) => o.includes('Sprint Alpha'));
    if (!sprintOption) { test.skip(true, 'Sprint option not in dropdown'); return; }
    await sprintSelect.selectOption({ label: sprintOption });

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  // Test 17
  test('combining multiple filters uses AND logic', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'critical', color: '#b91c1c' },
    });
    if (!labelRes.ok()) { test.skip(true, 'Label creation unavailable'); return; }
    const label = await labelRes.json();

    // Assign label to the high-priority card only
    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    const highCard = boardCards.find((c: any) => c.priority === 'high');
    if (!highCard) { test.skip(true, 'High priority card not found'); return; }
    await request.post(`${BASE}/api/cards/${highCard.id}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { label_id: label.id },
    });

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await labelSelect.selectOption(String(label.id));
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // label=critical AND priority=low → 0 cards
    await prioritySelect.selectOption('low');
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  // Test 18
  test('clear all filters button resets every active filter', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
    await expect(prioritySelect).toHaveValue('');
  });

  // Test 19
  test('filter state persists after opening and closing a card modal', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await setActivePriorityFilter(page, 'high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Open card modal and close it
    await page.locator('.card-item').first().click();
    await expect(page.locator('.card-detail-modal, .modal-overlay')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal, .modal-overlay')).not.toBeVisible({ timeout: 5000 });

    // Filter should still be active
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  // Test 20
  test('filter count badge (has-filters class) appears when a filter is active', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    // No filters yet — badge absent
    await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible();

    await setActivePriorityFilter(page, 'low');

    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible({ timeout: 5000 });
  });

  // Test 21
  test('no-results state shows zero cards when active filter matches nothing', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    // Overdue filter — none of the 3 cards have a past due date
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
    await page.locator('.filter-overdue').click();

    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible({ timeout: 5000 });
  });
});

// ===========================================================================
// 3 — Saved Filters
// ===========================================================================

test.describe('Saved Filters', () => {
  test.setTimeout(90000);

  // Test 22
  test('save-filter button appears only when filters are active', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // No filter active yet — save button absent
    await expect(page.locator('.save-filter-btn')).not.toBeVisible();

    await setActivePriorityFilter(page, 'high');
    await expect(page.locator('.save-filter-btn')).toBeVisible({ timeout: 5000 });
  });

  // Test 23
  test('loading a saved filter restores the saved filter state', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Load Test Filter');

    // Clear all active filters
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();

    if (!(await page.locator('.filters-expanded').isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
    }
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toHaveValue('');

    // Apply the saved filter
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await page.locator('.saved-filter-apply').filter({ hasText: 'Load Test Filter' }).click();

    await expect(prioritySelect).toHaveValue('high');
  });

  // Test 24
  test('deleting a saved filter removes it from the dropdown', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await setActivePriorityFilter(page, 'medium');
    await saveFilter(page, 'Delete Me Filter');

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).toBeVisible();

    const filterItem = page.locator('.saved-filter-item').filter({
      has: page.locator('.saved-filter-name:has-text("Delete Me Filter")'),
    });
    await filterItem.locator('.saved-filter-delete').click();

    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).not.toBeVisible({ timeout: 5000 });
  });

  // Test 25
  test('saved filter persists across a full page reload (server-side storage)', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Persist Session Filter');

    await page.reload();
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Persist Session Filter")')).toBeVisible();
  });

  // Test 26
  test('saved filter appears in the saved-filters dropdown after saving', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await setActivePriorityFilter(page, 'low');
    await saveFilter(page, 'Dropdown Appear Filter');

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Dropdown Appear Filter")')).toBeVisible();
  });

  // Test 27 — API: POST saved filter returns 201
  test('POST /api/boards/:id/filters returns 201 with id and name', async ({ request }) => {
    const setup = await setupFilterBoard(request);

    const res = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        name: 'API Test Filter',
        filter_json: JSON.stringify({ priority: 'high' }),
        is_shared: false,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('API Test Filter');
  });

  // Test 28 — API: GET saved filters returns array
  test('GET /api/boards/:id/filters returns array of saved filters', async ({ request }) => {
    const setup = await setupFilterBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'List Filter', filter_json: JSON.stringify({ priority: 'low' }), is_shared: false },
    });

    const res = await request.get(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(res.status()).toBe(200);
    const filters: any[] = await res.json();
    expect(Array.isArray(filters)).toBe(true);
    expect(filters.some((f: any) => f.name === 'List Filter')).toBe(true);
  });

  // Test 29 — API: DELETE saved filter removes it
  test('DELETE /api/boards/:id/filters/:filterId removes the filter', async ({ request }) => {
    const setup = await setupFilterBoard(request);

    const createRes = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'To Delete', filter_json: JSON.stringify({ priority: 'high' }), is_shared: false },
    });
    const { id } = await createRes.json();

    const delRes = await request.delete(
      `${BASE}/api/boards/${setup.boardId}/filters/${id}`,
      { headers: { Authorization: `Bearer ${setup.token}` } },
    );
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const filters: any[] = await listRes.json();
    expect(filters.find((f: any) => f.id === id)).toBeUndefined();
  });

  // Test 30 — saved filter scoped to a board
  test('saved filter is board-specific — does not appear on another board', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.token, setup.boardId);

    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Board A Filter');

    const boardB = await createBoard(request, setup.token, `Board B ${Date.now()}`);

    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Board A Filter")')).not.toBeVisible();
  });

  // Test 31 — empty saved-filters dropdown shows message
  test('empty saved-filters dropdown shows "No saved filters" placeholder', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Empty SF Board ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filters-empty')).toBeVisible();
    await expect(page.locator('.saved-filters-empty')).toContainText('No saved filters');
  });
});

// ===========================================================================
// 4 — Backlog Search / Filter
// ===========================================================================

test.describe('Backlog Search and Filter', () => {
  test.setTimeout(90000);

  // Test 32 — fixme: backlog inline search not yet implemented
  test.fixme('backlog view has an inline search input', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Backlog Search ${Date.now()}`);
    await navigateToBacklog(page, token, board.id);
    await expect(
      page.locator('.backlog-search-input, .backlog-view .search-input'),
    ).toBeVisible();
  });

  // Test 33 — fixme: backlog label filter not yet built
  test.fixme('backlog can be filtered by label', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Backlog Label Filter ${Date.now()}`);
    await navigateToBacklog(page, token, board.id);
    await expect(
      page.locator('.backlog-label-filter, .backlog-view .filter-select'),
    ).toBeVisible();
  });

  // Test 34 — fixme: backlog priority filter not yet built
  test.fixme('backlog can be filtered by priority', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Backlog Priority Filter ${Date.now()}`);
    await navigateToBacklog(page, token, board.id);
    await expect(page.locator('.backlog-priority-filter')).toBeVisible();
  });

  // Test 35
  test('backlog groups cards by sprint — unassigned/backlog section visible', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Backlog Groups ${Date.now()}`);

    await navigateToBacklog(page, token, board.id);

    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(
      page.locator('.sprint-section, .backlog-section, .backlog-group'),
    ).toBeVisible({ timeout: 8000 });
  });

  // Test 36 — fixme: backlog search clear not yet implemented
  test.fixme('clearing backlog search input restores all backlog items', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `Backlog Clear ${Date.now()}`);
    await navigateToBacklog(page, token, board.id);
    const searchInput = page.locator('.backlog-search-input input');
    await searchInput.fill('some text');
    await searchInput.fill('');
    // All backlog items should be visible again
    await expect(page.locator('.backlog-card, .backlog-item, .card-item')).toHaveCount(0, { timeout: 5000 });
  });
});

// ===========================================================================
// 5 — Reports Search / Filter
// ===========================================================================

test.describe('Reports Search', () => {
  test.setTimeout(90000);

  // Test 37
  test('reports page contains a board selector control', async ({ page, request }) => {
    const { token } = await createUser(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-page, .reports-container', { timeout: 15000 });

    await expect(
      page.locator('.board-select, select[name="board"], .reports-board-selector'),
    ).toBeVisible({ timeout: 8000 });
  });

  // Test 38 — fixme: velocity date-range filter not built yet
  test.fixme('velocity chart can be filtered by date range', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-page, .reports-container', { timeout: 15000 });
    await expect(page.locator('.velocity-date-range-picker')).toBeVisible({ timeout: 5000 });
  });

  // Test 39
  test('boards created by the user appear in the reports board selector', async ({ page, request }) => {
    const { token } = await createUser(request);
    const boardA = await createBoard(request, token, `Reports Board A ${Date.now()}`);
    const boardB = await createBoard(request, token, `Reports Board B ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-page, .reports-container', { timeout: 15000 });

    const boardSelect = page.locator('.board-select, select[name="board"], .reports-board-selector');
    await expect(boardSelect).toBeVisible({ timeout: 8000 });

    const options = await boardSelect.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Reports Board A'))).toBe(true);
    expect(options.some((o) => o.includes('Reports Board B'))).toBe(true);
  });
});

// ===========================================================================
// 6 — Card Search Within a Board (UI)
// ===========================================================================

test.describe('Card Search Within Board (UI)', () => {
  test.setTimeout(90000);

  // Test 40
  test('search filters cards within the specific board only', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.locator('.search-input input').fill('Low Priority Card');

    await expect(page.locator('.card-item[aria-label="Low Priority Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).not.toBeVisible();
    await expect(page.locator('.card-item[aria-label="Normal Card"]')).not.toBeVisible();
  });

  // Test 41 — fixme: term highlight not implemented
  test.fixme('matching search term is highlighted in card titles', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }
    await navigateToBoard(page, setup.token, setup.boardId);
    await page.locator('.search-input input').fill('High');
    await expect(page.locator('.card-item mark, .card-item .highlight')).toBeVisible({ timeout: 5000 });
  });

  // Test 42
  test('search updates URL q= parameter in real time', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `URL Param Search ${Date.now()}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.locator('.search-input input').fill('myquery');

    await page.waitForFunction(
      () => window.location.search.includes('q=myquery'),
      { timeout: 5000 },
    );
    expect(page.url()).toContain('q=myquery');
  });

  // Test 43
  test('card list updates in real-time as the user types each character', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    await navigateToBoard(page, setup.token, setup.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    const searchInput = page.locator('.search-input input');

    await searchInput.fill('H');
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 5000 });

    await searchInput.fill('Hi');
    await expect(page.locator('.card-item[aria-label="High Priority Card"]')).toBeVisible({ timeout: 5000 });

    await searchInput.fill('High Priority Card');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
  });
});

// ===========================================================================
// 7 — API Search Endpoint
// ===========================================================================

test.describe('API Search Endpoint', () => {
  test.setTimeout(60000);

  // Test 44
  test('GET /api/cards/search?q&board_id returns matching cards array + total', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Match ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    const c1 = await createCard(request, token, {
      title: 'Searchable Alpha Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (!c1) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, {
      title: 'Irrelevant Beta Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });

    const res = await request.get(
      `${BASE}/api/cards/search?q=Alpha&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.some((c: any) => c.title === 'Searchable Alpha Card')).toBe(true);
    expect(cards.some((c: any) => c.title === 'Irrelevant Beta Card')).toBe(false);
    expect(typeof body.total).toBe('number');
  });

  // Test 45
  test('search API returns empty array and total=0 for no matches', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Empty ${Date.now()}`);

    const res = await request.get(
      `${BASE}/api/cards/search?q=ZZZNO_MATCH_XYZ&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.length).toBe(0);
    if (typeof body.total !== 'undefined') {
      expect(body.total).toBe(0);
    }
  });

  // Test 46
  test('search API requires board_id — omitting it returns 400', async ({ request }) => {
    const { token } = await createUser(request);

    const res = await request.get(
      `${BASE}/api/cards/search?q=test`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(400);
  });

  // Test 47
  test('search API requires authentication — missing token returns 401', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API No Auth ${Date.now()}`);

    const res = await request.get(`${BASE}/api/cards/search?q=test&board_id=${board.id}`);
    expect(res.status()).toBe(401);
  });

  // Test 48
  test('search API filters by priority param and returns only matching cards', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Priority Filter ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    const c1 = await createCard(request, token, {
      title: 'High Priority API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
      priority: 'high',
    });
    if (!c1) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, {
      title: 'Low Priority API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
      priority: 'low',
    });

    const res = await request.get(
      `${BASE}/api/cards/search?priority=high&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.every((c: any) => c.priority === 'high')).toBe(true);
  });

  // Test 49
  test('search API filters by overdue=true returns only past-due cards', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Overdue ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    const c = await createCard(request, token, {
      title: 'Overdue API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (!c) { test.skip(true, 'Card creation unavailable'); return; }

    // Set a past due date
    await request.put(`${BASE}/api/cards/${c.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Overdue API Card', description: '', due_date: '2020-01-01' },
    });

    // Create a future-dated card that must NOT appear in overdue results
    const c2 = await createCard(request, token, {
      title: 'Future API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (c2) {
      await request.put(`${BASE}/api/cards/${c2.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Future API Card', description: '', due_date: '2099-01-01' },
      });
    }

    const res = await request.get(
      `${BASE}/api/cards/search?overdue=true&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.some((cd: any) => cd.title === 'Overdue API Card')).toBe(true);
    expect(cards.some((cd: any) => cd.title === 'Future API Card')).toBe(false);
  });

  // Test 50
  test('search API returns 403 for a board the user has no access to', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Private Board Owner');
    const board = await createBoard(request, ownerToken, `Private Board ${Date.now()}`);

    const { token: strangerToken } = await createUser(request, 'Stranger');

    const res = await request.get(
      `${BASE}/api/cards/search?board_id=${board.id}&q=test`,
      { headers: { Authorization: `Bearer ${strangerToken}` } },
    );
    expect([403, 404]).toContain(res.status());
  });

  // Test 51 — bonus: pagination via limit param
  test('search API respects the limit param and returns at most limit cards', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Pagination ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    for (let i = 1; i <= 3; i++) {
      const c = await createCard(request, token, {
        title: `Paginate Card ${i}`,
        boardId: board.id,
        columnId: sortedCols[0].id,
        swimlaneId,
      });
      if (!c) { test.skip(true, 'Card creation unavailable'); return; }
    }

    const res = await request.get(
      `${BASE}/api/cards/search?board_id=${board.id}&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.length).toBe(1);
  });

  // Test 52 — bonus: sprint_id=-1 returns only unassigned cards
  test('search API with sprint_id=-1 returns only cards not in any sprint', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Sprint -1 ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    const c1 = await createCard(request, token, {
      title: 'Unassigned Sprint Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (!c1) { test.skip(true, 'Card creation unavailable'); return; }

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint One' },
    });
    if (!sprintRes.ok()) { test.skip(true, 'Sprint creation unavailable'); return; }
    const sprint = await sprintRes.json();

    const c2 = await createCard(request, token, {
      title: 'Sprint Assigned Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (!c2) { test.skip(true, 'Card creation unavailable'); return; }
    await request.put(`${BASE}/api/cards/${c2.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Sprint Assigned Card', description: '', sprint_id: sprint.id },
    });

    const res = await request.get(
      `${BASE}/api/cards/search?sprint_id=-1&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.some((cd: any) => cd.title === 'Unassigned Sprint Card')).toBe(true);
    expect(cards.some((cd: any) => cd.title === 'Sprint Assigned Card')).toBe(false);
  });

  // Test 53 — bonus: assignee filter on search API
  test('search API filters by assignee param and excludes unassigned cards', async ({ request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, `API Assignee ${Date.now()}`);
    const cols = await getColumns(request, token, board.id);
    const sortedCols = [...cols].sort((a, b) => a.position - b.position);
    const { id: swimlaneId } = await createSwimlane(request, token, board.id);

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok()) { test.skip(true, 'Cannot fetch current user'); return; }
    const me = await meRes.json();

    const c1 = await createCard(request, token, {
      title: 'Assigned API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });
    if (!c1) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, {
      title: 'Unassigned API Card',
      boardId: board.id,
      columnId: sortedCols[0].id,
      swimlaneId,
    });

    await request.post(`${BASE}/api/cards/${c1.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: me.id },
    });

    const res = await request.get(
      `${BASE}/api/cards/search?assignee=${me.id}&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.some((cd: any) => cd.title === 'Assigned API Card')).toBe(true);
    expect(cards.some((cd: any) => cd.title === 'Unassigned API Card')).toBe(false);
  });
});
