import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Column {
  id: number;
  name: string;
  state: string;
  position: number;
}

interface Board {
  id: number;
  name: string;
  columns: Column[];
}

async function createUser(request: any, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Template Tester' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

async function createBoard(
  request: any,
  token: string,
  name: string,
  template?: string,
): Promise<Board> {
  const data: Record<string, string> = { name };
  if (template !== undefined) data.template = template;

  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return (await res.json()) as Board;
}

async function getBoardColumns(request: any, token: string, boardId: number): Promise<Column[]> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as Column[];
}

// ---------------------------------------------------------------------------
// API-level template tests
// ---------------------------------------------------------------------------

test.describe('Board Templates — API', () => {
  test('default template creates To Do / In Progress / In Review / Done columns', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-default');
    const board = await createBoard(request, token, 'Default Board');
    const columns = await getBoardColumns(request, token, board.id);

    const names = columns.map((c) => c.name);
    expect(names).toContain('To Do');
    expect(names).toContain('In Progress');
    expect(names).toContain('In Review');
    expect(names).toContain('Done');
    expect(columns).toHaveLength(4);
  });

  test('kanban template creates To Do / In Progress / Done columns', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-kanban');
    const board = await createBoard(request, token, 'Kanban Board', 'kanban');
    const columns = await getBoardColumns(request, token, board.id);

    const names = columns.map((c) => c.name);
    expect(names).toEqual(['To Do', 'In Progress', 'Done']);
    expect(columns).toHaveLength(3);
  });

  test('scrum template creates Backlog / To Do / In Progress / Review / Done columns', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-scrum');
    const board = await createBoard(request, token, 'Scrum Board', 'scrum');
    const columns = await getBoardColumns(request, token, board.id);

    const names = columns.map((c) => c.name);
    expect(names).toEqual(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']);
    expect(columns).toHaveLength(5);
  });

  test("bug_triage template creates New / Confirmed / In Progress / Fixed / Won't Fix columns", async ({ request }) => {
    const { token } = await createUser(request, 'tpl-bug');
    const board = await createBoard(request, token, 'Bug Triage Board', 'bug_triage');
    const columns = await getBoardColumns(request, token, board.id);

    const names = columns.map((c) => c.name);
    expect(names).toEqual(['New', 'Confirmed', 'In Progress', 'Fixed', "Won't Fix"]);
    expect(columns).toHaveLength(5);
  });

  test('template column states: Done/Fixed have closed state; others are open or in_progress', async ({ request }) => {
    // Verify all three templates' closed columns and open/in_progress columns
    const { token } = await createUser(request, 'tpl-states');

    // Kanban
    const kanban = await createBoard(request, token, 'Kanban States', 'kanban');
    const kanbanCols = await getBoardColumns(request, token, kanban.id);
    const kanbanByName = Object.fromEntries(kanbanCols.map((c) => [c.name, c.state]));
    expect(kanbanByName['To Do']).toBe('open');
    expect(kanbanByName['In Progress']).toBe('in_progress');
    expect(kanbanByName['Done']).toBe('closed');

    // Scrum
    const scrum = await createBoard(request, token, 'Scrum States', 'scrum');
    const scrumCols = await getBoardColumns(request, token, scrum.id);
    const scrumByName = Object.fromEntries(scrumCols.map((c) => [c.name, c.state]));
    expect(scrumByName['Backlog']).toBe('open');
    expect(scrumByName['To Do']).toBe('open');
    expect(scrumByName['In Progress']).toBe('in_progress');
    expect(scrumByName['Review']).toBe('in_progress');
    expect(scrumByName['Done']).toBe('closed');

    // Bug triage
    const bug = await createBoard(request, token, 'Bug States', 'bug_triage');
    const bugCols = await getBoardColumns(request, token, bug.id);
    const bugByName = Object.fromEntries(bugCols.map((c) => [c.name, c.state]));
    expect(bugByName['New']).toBe('open');
    expect(bugByName['Confirmed']).toBe('open');
    expect(bugByName['In Progress']).toBe('in_progress');
    expect(bugByName['Fixed']).toBe('closed');
    expect(bugByName["Won't Fix"]).toBe('closed');
  });

  test('empty string template behaves identically to no template (default columns)', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-empty');

    const withEmpty = await createBoard(request, token, 'Empty Template Board', '');
    const withNone = await createBoard(request, token, 'No Template Board');

    const emptyColumns = await getBoardColumns(request, token, withEmpty.id);
    const noneColumns = await getBoardColumns(request, token, withNone.id);

    const emptyNames = emptyColumns.map((c) => c.name);
    const noneNames = noneColumns.map((c) => c.name);
    expect(emptyNames).toEqual(noneNames);
  });

  test('board response from POST includes columns array', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-response');
    const board = await createBoard(request, token, 'Response Check', 'kanban');

    // The board object returned by POST /api/boards should include columns
    expect(Array.isArray(board.columns)).toBe(true);
    expect(board.columns.length).toBeGreaterThan(0);
    const names = board.columns.map((c) => c.name);
    expect(names).toContain('To Do');
    expect(names).toContain('Done');
  });
});

// ---------------------------------------------------------------------------
// UI-level template tests
// ---------------------------------------------------------------------------

test.describe('Board Templates — Create Board UI', () => {
  test('template selector is present in the create board modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-sel');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    // Template select element should be present with its label
    const templateSelect = page.locator('#boardTemplate');
    await expect(templateSelect).toBeVisible();

    // Verify all expected options are present
    await expect(templateSelect.locator('option[value=""]')).toBeAttached();
    await expect(templateSelect.locator('option[value="kanban"]')).toBeAttached();
    await expect(templateSelect.locator('option[value="scrum"]')).toBeAttached();
    await expect(templateSelect.locator('option[value="bug_triage"]')).toBeAttached();
  });

  test('default option text describes default columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-default-opt');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    const defaultOption = page.locator('#boardTemplate option[value=""]');
    const text = await defaultOption.textContent();
    expect(text).toMatch(/default/i);
  });

  test('creating a board with kanban template from UI shows correct columns in settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-kanban');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    // Open create modal
    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    // Fill name and select kanban template
    const boardName = `Kanban UI ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('kanban');

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    // Wait for navigation to the new board
    await page.waitForURL(/\/boards\/\d+$/);
    const url = page.url();
    const newBoardId = url.match(/\/boards\/(\d+)/)?.[1];
    expect(newBoardId).toBeTruthy();

    // Go to settings to verify columns
    await page.goto(`/boards/${newBoardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();

    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
    // Kanban has exactly 3 columns; no "In Review" or "Backlog"
    expect(names).toHaveLength(3);
    expect(names.some((n) => /in review/i.test(n))).toBe(false);
    expect(names.some((n) => /backlog/i.test(n))).toBe(false);
  });

  test('creating a board with scrum template from UI shows correct columns in settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-scrum');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    const boardName = `Scrum UI ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('scrum');

    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();
    await page.waitForURL(/\/boards\/\d+$/);

    const url = page.url();
    const newBoardId = url.match(/\/boards\/(\d+)/)?.[1];
    expect(newBoardId).toBeTruthy();

    await page.goto(`/boards/${newBoardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();

    expect(names.some((n) => /backlog/i.test(n))).toBe(true);
    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /review/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
    expect(names).toHaveLength(5);
  });

  test('creating a board with bug_triage template from UI shows correct columns in settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-bug');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    const boardName = `Bug UI ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('bug_triage');

    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();
    await page.waitForURL(/\/boards\/\d+$/);

    const url = page.url();
    const newBoardId = url.match(/\/boards\/(\d+)/)?.[1];
    expect(newBoardId).toBeTruthy();

    await page.goto(`/boards/${newBoardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();

    expect(names.some((n) => /^new$/i.test(n.trim()))).toBe(true);
    expect(names.some((n) => /confirmed/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /fixed/i.test(n))).toBe(true);
    expect(names.some((n) => /won.t fix/i.test(n))).toBe(true);
    expect(names).toHaveLength(5);
  });

  test('creating a board with default (no template) from UI shows standard columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-none');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    const boardName = `Default UI ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    // Leave template selector at its default value (empty string = default)

    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();
    await page.waitForURL(/\/boards\/\d+$/);

    const url = page.url();
    const newBoardId = url.match(/\/boards\/(\d+)/)?.[1];
    expect(newBoardId).toBeTruthy();

    await page.goto(`/boards/${newBoardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();

    // Default template: To Do, In Progress, In Review, Done
    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /in review/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
    expect(names).toHaveLength(4);
  });

  test('board name is required — submit without name does not navigate away', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-noname');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();

    // Select a template but leave name empty
    await page.locator('#boardTemplate').selectOption('scrum');

    // Attempt to submit — browser native validation should prevent form submission
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    // Modal should still be visible (form not submitted)
    await expect(page.locator('.modal')).toBeVisible();
    // Still on /boards
    expect(page.url()).toMatch(/\/boards\/?$/);
  });

  test('cancel button closes the create board modal without creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'tpl-ui-cancel');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('#boardName').fill('Should Not Exist');
    await page.locator('#boardTemplate').selectOption('kanban');

    await page.locator('.modal button:has-text("Cancel")').click();

    // Modal should be gone
    await expect(page.locator('.modal')).not.toBeVisible();
    // No board with that name should appear
    await expect(page.locator('.board-card h3:has-text("Should Not Exist")')).not.toBeVisible();
  });
});
