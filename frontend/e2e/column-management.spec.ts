import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh user + board via API, inject JWT, and return both.
 * The page is NOT navigated — callers choose when and where to navigate.
 */
async function setupUserAndBoard(
  request: any,
  page: any,
  boardName = 'Column Test Board',
) {
  const email = `test-col-${crypto.randomUUID()}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Column Tester' },
  });
  const { token } = await signupRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  return { token, board };
}

/** Fetch all columns for a board via API. */
async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<Array<{ id: number; name: string; state: string; position: number }>>;
}

/** Add a column via API. */
async function addColumn(
  request: any,
  token: string,
  boardId: number,
  name: string,
  state = 'open',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, state },
  });
  return res.json() as Promise<{ id: number; name: string; state: string }>;
}

/** Create a swimlane via API (required before cards can be added). */
async function addSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'TL-', color: '#3b82f6' },
  });
  return res.json() as Promise<{ id: number }>;
}

/** Create a card via API. */
async function addCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title = 'Test Card',
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title, description: '' },
  });
  return res.json() as Promise<{ id: number; title: string; column_id: number }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Column Management', () => {

  // 1. Default columns on new board
  test('new board has default To Do, In Progress, and Done columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);

    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThanOrEqual(3);

    const names = columns.map(c => c.name);
    expect(names.some(n => /to do/i.test(n))).toBe(true);
    expect(names.some(n => /in progress/i.test(n))).toBe(true);
    expect(names.some(n => /done/i.test(n))).toBe(true);
  });

  // 2. Column state field reflected in API
  test('GET /api/boards/:id/columns returns a state field on each column', async ({ request, page }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const validStates = new Set(['open', 'in_progress', 'review', 'closed']);

    expect(columns.length).toBeGreaterThan(0);
    for (const col of columns) {
      expect(col).toHaveProperty('state');
      expect(validStates.has(col.state)).toBe(true);
    }
  });

  // 3. Cards in closed-state column excluded from backlog
  test('cards placed in a closed-state column do not appear in the backlog panel', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    // A card in an open column should appear in backlog
    await addCard(request, token, board.id, swimlane.id, openColumn!.id, 'Visible Backlog Card');
    // A card in a closed column must be filtered out
    await addCard(request, token, board.id, swimlane.id, closedColumn!.id, 'Hidden Done Card');

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    await expect(page.locator('.backlog-card:has-text("Visible Backlog Card")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.backlog-card:has-text("Hidden Done Card")')).not.toBeVisible();
  });

  // 4. Cards in closed-state column excluded from sprint panel card list
  test('closed-state column cards are excluded from sprint panel in backlog view', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    // Card in open column
    await addCard(request, token, board.id, swimlane.id, openColumn!.id, 'Open Sprint Card');
    // Card in closed column — must not show up in sprint panel
    await addCard(request, token, board.id, swimlane.id, closedColumn!.id, 'Closed Sprint Card');

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    // Closed-column card title must not appear anywhere in the backlog view
    await expect(page.locator('.backlog-card:has-text("Closed Sprint Card"), .sprint-card:has-text("Closed Sprint Card")')).toHaveCount(0);
  });

  // 5. Rename column in settings (via Add + reorder workflow — no rename endpoint exists,
  //    so this test verifies the column name shown in the column header after adding)
  test('column name added via settings appears in the board column header', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    // Add a swimlane so column headers are rendered on the board
    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('Review Queue');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // Navigate to board and switch to All Cards so columns are visible
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.board-column-header h3:has-text("Review Queue")')).toBeVisible({ timeout: 8000 });
  });

  // 6. Add column with specific 'in_progress' state via settings
  test('adding a column with in_progress state shows correct state badge in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('QA Testing');
    await page.locator('.modal select').selectOption('in_progress');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // The column row must show state: in_progress
    const newRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'QA Testing' });
    await expect(newRow.locator('.item-meta')).toHaveText('State: in_progress');
  });

  // 7. Column appears at the end of the board after being added
  test('newly added column appears as the last item in the settings column list', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const beforeCount = await columnsSection.locator('.settings-list-item').count();

    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Trailing Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    const items = columnsSection.locator('.settings-list-item');
    await expect(items).toHaveCount(beforeCount + 1);

    const lastName = await items.last().locator('.item-name').textContent();
    expect(lastName).toBe('Trailing Column');
  });

  // 8. Board with many columns scrolls horizontally
  test('board with 6+ columns renders all column headers and board-content is horizontally scrollable', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page, 'Wide Board');

    // Add 6 extra columns via API on top of the 3-4 defaults
    for (let i = 1; i <= 6; i++) {
      await addColumn(request, token, board.id, `Extra Col ${i}`, 'open');
    }

    // Create a swimlane so the board renders column headers
    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    // At least 9 column headers should be visible (3 defaults + 6 extras)
    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThanOrEqual(9);

    // board-content must have overflow-x set to auto or scroll
    const boardContent = page.locator('.board-content');
    await expect(boardContent).toBeVisible();
    const overflowX = await boardContent.evaluate(
      (el: Element) =>
        window.getComputedStyle(el).overflowX,
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  // 9. Delete column with cards shows a confirmation dialog
  test('attempting to delete a column triggers a window.confirm dialog', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const targetColumn = columns.find(c => c.state === 'open');
    expect(targetColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);
    await addCard(request, token, board.id, swimlane.id, targetColumn!.id, 'Card In Column');

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const targetRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: targetColumn!.name });

    let dialogShown = false;
    page.once('dialog', async (dialog) => {
      dialogShown = true;
      // Dismiss so the column is not deleted
      await dialog.dismiss();
    });

    await targetRow.locator('.item-delete').click();

    expect(dialogShown).toBe(true);

    // Column must still be present after dismissal
    await expect(columnsSection.locator(`.item-name:has-text("${targetColumn!.name}")`)).toBeVisible();
  });

  // 10. Column position order: API returns columns sorted ascending by position
  test('API returns columns in ascending position order', async ({ request, page }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    // Add a couple of extra columns to exercise ordering beyond the defaults
    await addColumn(request, token, board.id, 'Omega', 'open');
    await addColumn(request, token, board.id, 'Zeta', 'in_progress');

    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThan(1);

    for (let i = 1; i < columns.length; i++) {
      expect(columns[i].position).toBeGreaterThanOrEqual(columns[i - 1].position);
    }
  });
});
