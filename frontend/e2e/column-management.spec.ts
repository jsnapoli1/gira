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
  template = '',
) {
  const email = `test-col-${Date.now()}-${crypto.randomUUID()}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Column Tester' },
  });
  const { token } = await signupRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

  const body: Record<string, string> = { name: boardName };
  if (template) body.template = template;

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  const board = await boardRes.json();

  return { token, board };
}

/**
 * Fetch all columns for a board via API.
 */
async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<Array<{ id: number; name: string; state: string; position: number }>>;
}

/**
 * Add a column via API.
 */
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

/**
 * Create a swimlane via API (required before cards can be added).
 */
async function addSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'TL-', color: '#3b82f6' },
  });
  return res.json() as Promise<{ id: number }>;
}

/**
 * Create a card via API.
 */
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
  // ── 1. Default columns on new board ──────────────────────────────────────

  test('new board has default columns: To Do, In Progress, and Done', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await expect(columnsSection.locator('.item-name').first()).toBeVisible();

    const names = await columnsSection.locator('.item-name').allTextContents();
    expect(names.some(n => /to do/i.test(n))).toBe(true);
    expect(names.some(n => /in progress/i.test(n))).toBe(true);
    expect(names.some(n => /done/i.test(n))).toBe(true);
  });

  // ── 2. Column state badge in settings list ────────────────────────────────

  test('each column row shows its state via the item-meta label', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    // Default board has at least 3 columns. Each should display "State: <state>"
    const metaLabels = await columnsSection.locator('.item-meta').allTextContents();
    expect(metaLabels.length).toBeGreaterThanOrEqual(3);
    // Every meta label should contain the "State:" prefix
    for (const label of metaLabels) {
      expect(label).toMatch(/State:/i);
    }
    // The default set always includes open, in_progress and closed states
    const states = metaLabels.map(l => l.replace(/State:\s*/i, '').trim());
    expect(states).toContain('open');
    expect(states).toContain('closed');
  });

  // ── 3. Cards in 'closed' state columns are excluded from backlog ──────────

  test('cards in closed-state columns do not appear in the backlog panel', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    // Create one card in an open column (should appear in backlog)
    await addCard(request, token, board.id, swimlane.id, openColumn!.id, 'Backlog Visible Card');
    // Create one card in a closed column (should NOT appear in backlog)
    await addCard(request, token, board.id, swimlane.id, closedColumn!.id, 'Closed Column Card');

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    // Give the backlog view time to render
    await page.waitForTimeout(500);

    // The open-column card's title must be visible in the backlog area
    await expect(page.locator('.backlog-card:has-text("Backlog Visible Card")')).toBeVisible({ timeout: 8000 });
    // The closed-column card's title must NOT appear in the backlog section
    await expect(page.locator('.backlog-card:has-text("Closed Column Card")')).not.toBeVisible();
  });

  // ── 4. Cards in 'closed' state columns excluded from sprint panel ─────────

  test('sprint panel only counts cards from non-closed columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    // Create a sprint
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Alpha', goal: '' },
    });
    const sprint = await sprintRes.json();

    // Add a card in an open column and assign it to the sprint
    const openCard = await addCard(request, token, board.id, swimlane.id, openColumn!.id, 'Sprint Open Card');
    await request.post(`${BASE}/api/cards/${openCard.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    // Add a card in a closed column and assign it to the sprint
    const closedCard = await addCard(request, token, board.id, swimlane.id, closedColumn!.id, 'Sprint Closed Card');
    await request.post(`${BASE}/api/cards/${closedCard.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    // The sprint panel should list only 1 card (the open-column one)
    // The sprint-card-count badge counts non-closed cards
    const sprintPanel = page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Alpha' });
    await expect(sprintPanel).toBeVisible({ timeout: 8000 });
    await expect(sprintPanel.locator('.sprint-card-count')).toHaveText('1 cards');
  });

  // ── 5. Column with cards shows confirmation before deletion ───────────────

  test('deleting a column that has cards triggers a confirmation dialog', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

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

    // Dismiss the dialog (cancel) — column should remain
    page.once('dialog', dialog => dialog.dismiss());
    await targetRow.locator('.item-delete').click();

    // Column should still be present after cancellation
    await expect(columnsSection.locator(`.item-name:has-text("${targetColumn!.name}")`)).toBeVisible();
  });

  // ── 6. Add column with custom name and verify it appears in settings ───────

  test('adding a "Code Review" column shows it in the settings column list', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('Code Review');

    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("Code Review")')).toBeVisible();
  });

  // ── 7. Column position — newly added column appears last ──────────────────

  test('a newly added column appears as the last column in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });

    // Record how many columns exist before adding
    const beforeCount = await columnsSection.locator('.settings-list-item').count();

    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Last Position');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    const items = columnsSection.locator('.settings-list-item');
    await expect(items).toHaveCount(beforeCount + 1);

    // The new column should be the last item
    const lastName = await items.last().locator('.item-name').textContent();
    expect(lastName).toBe('Last Position');
  });

  // ── 8. Adding column with in_progress state — state appears correctly ─────

  test('column added with in_progress state displays "State: in_progress" in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('Active Work');
    // Change state dropdown to in_progress
    await page.locator('.modal select').selectOption('in_progress');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // Verify the row for this column shows the state
    const newRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Active Work' });
    await expect(newRow.locator('.item-meta')).toHaveText('State: in_progress');
  });

  // ── 9. Adding column with closed state — excluded from backlog immediately ─

  test('column added with closed state causes cards placed in it to be excluded from backlog', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

    // Add a new closed-state column via API
    const closedCol = await addColumn(request, token, board.id, 'Archive', 'closed');
    const swimlane = await addSwimlane(request, token, board.id);

    // Place a card directly into the closed column
    await addCard(request, token, board.id, swimlane.id, closedCol.id, 'Archived Card');

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    // The archived card must not appear in the backlog
    await expect(page.locator('.backlog-card:has-text("Archived Card")')).not.toBeVisible();
  });

  // ── 10. Board with many columns (6+) renders all columns in settings ───────

  test('board with 6+ columns lists all of them in settings', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

    // Default board has 4 columns; add 3 more to reach 7
    await addColumn(request, token, board.id, 'Extra 1', 'open');
    await addColumn(request, token, board.id, 'Extra 2', 'in_progress');
    await addColumn(request, token, board.id, 'Extra 3', 'open');

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await expect(columnsSection.locator('.settings-list-item').first()).toBeVisible();
    const count = await columnsSection.locator('.settings-list-item').count();
    expect(count).toBeGreaterThanOrEqual(7);

    // All expected column names are present
    const names = await columnsSection.locator('.item-name').allTextContents();
    expect(names).toContain('Extra 1');
    expect(names).toContain('Extra 2');
    expect(names).toContain('Extra 3');
  });

  // ── 11. Board template columns — kanban ───────────────────────────────────

  test('kanban template board creates To Do, In Progress, Done columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request, 'Kanban Board', 'kanban');

    const columns = await getColumns(request, token, board.id);
    const names = columns.map(c => c.name);

    expect(names).toContain('To Do');
    expect(names).toContain('In Progress');
    expect(names).toContain('Done');
    // Kanban template has exactly 3 columns
    expect(columns).toHaveLength(3);
  });

  // ── 12. Board template columns — scrum ────────────────────────────────────

  test('scrum template board creates Backlog, To Do, In Progress, Review, Done columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request, 'Scrum Board', 'scrum');

    const columns = await getColumns(request, token, board.id);
    const names = columns.map(c => c.name);

    expect(names).toContain('Backlog');
    expect(names).toContain('To Do');
    expect(names).toContain('In Progress');
    expect(names).toContain('Review');
    expect(names).toContain('Done');
    expect(columns).toHaveLength(5);
  });

  // ── 13. Board template columns — bug_triage ───────────────────────────────

  test('bug_triage template board creates New, Confirmed, In Progress, Fixed, Won\'t Fix columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request, 'Bug Triage Board', 'bug_triage');

    const columns = await getColumns(request, token, board.id);
    const names = columns.map(c => c.name);

    expect(names).toContain('New');
    expect(names).toContain('Confirmed');
    expect(names).toContain('In Progress');
    expect(names).toContain('Fixed');
    expect(names).toContain("Won't Fix");
    expect(columns).toHaveLength(5);
  });

  // ── 14. kanban vs scrum templates produce different column sets ───────────

  test('kanban and scrum templates produce distinct column layouts', async ({ page, request }) => {
    const { token: tk, board: kanbanBoard } = await setupUserAndBoard(page, request, 'Kanban', 'kanban');
    const { token: ts, board: scrumBoard } = await setupUserAndBoard(page, request, 'Scrum', 'scrum');

    const kanbanCols = await getColumns(request, tk, kanbanBoard.id);
    const scrumCols = await getColumns(request, ts, scrumBoard.id);

    expect(kanbanCols).toHaveLength(3);
    expect(scrumCols).toHaveLength(5);

    const kanbanNames = kanbanCols.map(c => c.name);
    const scrumNames = scrumCols.map(c => c.name);

    // Scrum has Backlog; kanban does not
    expect(scrumNames).toContain('Backlog');
    expect(kanbanNames).not.toContain('Backlog');
  });

  // ── 15. Column state options in the Add Column modal ─────────────────────

  test('Add Column modal exposes open, in_progress, review, closed state options', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();

    const stateSelect = page.locator('.modal select');
    await expect(stateSelect.locator('option[value="open"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="in_progress"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="review"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="closed"]')).toBeAttached();

    // Cancel without saving
    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  // ── 16. Column added in settings is visible on the board (All Cards view) ─

  test('a column added in settings appears as a board column header in All Cards view', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(page, request);

    // Create a swimlane so the board renders column headers
    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Staging');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // Navigate to board view in All Cards mode
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    // The new column header should be visible
    await expect(page.locator('.board-column-header h3:has-text("Staging")')).toBeVisible({ timeout: 8000 });
  });
});
