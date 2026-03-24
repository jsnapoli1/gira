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

interface CardTemplate {
  id: number;
  board_id: number;
  name: string;
  issue_type: string;
  description_template: string;
  created_at?: string;
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

async function createCardTemplate(
  request: any,
  token: string,
  boardId: number,
  name: string,
  descriptionTemplate: string,
  issueType = '',
): Promise<CardTemplate> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/templates`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description_template: descriptionTemplate, issue_type: issueType },
  });
  return (await res.json()) as CardTemplate;
}

async function listCardTemplates(
  request: any,
  token: string,
  boardId: number,
): Promise<CardTemplate[]> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as CardTemplate[];
}

// ---------------------------------------------------------------------------
// API-level board template tests (board creation templates)
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

  test('columns have sequential positions starting from 0 or 1', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-positions');
    const board = await createBoard(request, token, 'Position Board', 'scrum');
    const columns = await getBoardColumns(request, token, board.id);

    // Positions should be unique and ordered
    const positions = columns.map((c) => c.position).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test('default template columns have correct states', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-default-states');
    const board = await createBoard(request, token, 'Default States Board');
    const columns = await getBoardColumns(request, token, board.id);
    const byName = Object.fromEntries(columns.map((c) => [c.name, c.state]));

    expect(byName['To Do']).toBe('open');
    expect(byName['In Progress']).toBe('in_progress');
    expect(byName['In Review']).toBe('in_progress');
    expect(byName['Done']).toBe('closed');
  });

  test('each column has a board_id matching the created board', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-boardid');
    const board = await createBoard(request, token, 'Board ID Check', 'kanban');
    const columns = await getBoardColumns(request, token, board.id);

    for (const col of columns) {
      expect((col as any).board_id).toBe(board.id);
    }
  });
});

// ---------------------------------------------------------------------------
// UI-level board creation template tests
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

// ---------------------------------------------------------------------------
// Card templates — API tests
// ---------------------------------------------------------------------------

test.describe('Card Templates — API', () => {
  // -------------------------------------------------------------------------
  // POST /api/boards/:id/templates creates a card template
  // -------------------------------------------------------------------------
  test('POST /api/boards/:id/templates creates a card template', async ({ request }) => {
    const { token } = await createUser(request, 'ct-create');
    const board = await createBoard(request, token, 'Card Template Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Bug Report Template',
        issue_type: 'bug',
        description_template: '## Steps to Reproduce\n\n## Expected\n\n## Actual',
      },
    });
    expect(res.status()).toBe(201);
    const template: CardTemplate = await res.json();
    expect(template.id).toBeTruthy();
    expect(typeof template.id).toBe('number');
    expect(template.name).toBe('Bug Report Template');
    expect(template.description_template).toBe('## Steps to Reproduce\n\n## Expected\n\n## Actual');
  });

  // -------------------------------------------------------------------------
  // Template has id, name, board_id, description_template fields
  // -------------------------------------------------------------------------
  test('created card template has id, name, board_id, and description_template fields', async ({ request }) => {
    const { token } = await createUser(request, 'ct-fields');
    const board = await createBoard(request, token, 'Fields Check Board');

    const template = await createCardTemplate(
      request,
      token,
      board.id,
      'Feature Template',
      '## Overview\n\n## Acceptance Criteria',
      'feature',
    );

    expect(template.id).toBeTruthy();
    expect(template.board_id).toBe(board.id);
    expect(template.name).toBe('Feature Template');
    expect(template.description_template).toBe('## Overview\n\n## Acceptance Criteria');
  });

  // -------------------------------------------------------------------------
  // Template has issue_type field
  // -------------------------------------------------------------------------
  test('created card template has issue_type field', async ({ request }) => {
    const { token } = await createUser(request, 'ct-issue-type');
    const board = await createBoard(request, token, 'Issue Type Board');

    const template = await createCardTemplate(
      request,
      token,
      board.id,
      'Task Template',
      'Standard task description',
      'task',
    );

    expect(template.issue_type).toBe('task');
  });

  // -------------------------------------------------------------------------
  // GET /api/boards/:id/templates returns an array
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/templates returns an array', async ({ request }) => {
    const { token } = await createUser(request, 'ct-list-empty');
    const board = await createBoard(request, token, 'Empty Templates Board');

    const templates = await listCardTemplates(request, token, board.id);
    expect(Array.isArray(templates)).toBe(true);
    expect(templates).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // GET /api/boards/:id/templates returns created templates
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/templates returns previously created templates', async ({ request }) => {
    const { token } = await createUser(request, 'ct-list');
    const board = await createBoard(request, token, 'List Templates Board');

    await createCardTemplate(request, token, board.id, 'Template A', 'Description A');
    await createCardTemplate(request, token, board.id, 'Template B', 'Description B', 'bug');

    const templates = await listCardTemplates(request, token, board.id);
    expect(templates).toHaveLength(2);
    expect(templates.some((t) => t.name === 'Template A')).toBe(true);
    expect(templates.some((t) => t.name === 'Template B')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multiple templates for same board
  // -------------------------------------------------------------------------
  test('multiple card templates can be created for the same board', async ({ request }) => {
    const { token } = await createUser(request, 'ct-multi');
    const board = await createBoard(request, token, 'Multi Templates Board');

    const templateNames = ['Bug Template', 'Feature Template', 'Task Template', 'Epic Template'];
    for (const name of templateNames) {
      await createCardTemplate(request, token, board.id, name, `Description for ${name}`);
    }

    const templates = await listCardTemplates(request, token, board.id);
    expect(templates).toHaveLength(4);
    for (const name of templateNames) {
      expect(templates.some((t) => t.name === name)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/boards/:id/templates/:templateId removes template
  // -------------------------------------------------------------------------
  test('DELETE /api/boards/:id/templates/:id removes the template', async ({ request }) => {
    const { token } = await createUser(request, 'ct-delete');
    const board = await createBoard(request, token, 'Delete Template Board');

    const template = await createCardTemplate(
      request,
      token,
      board.id,
      'To Be Deleted',
      'Will be removed',
    );

    const delRes = await request.delete(
      `${BASE}/api/boards/${board.id}/templates/${template.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.status()).toBe(204);

    const templates = await listCardTemplates(request, token, board.id);
    expect(templates.some((t) => t.id === template.id)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Deleting one of multiple templates removes only the correct one
  // -------------------------------------------------------------------------
  test('deleting one template does not remove the other templates', async ({ request }) => {
    const { token } = await createUser(request, 'ct-delete-one');
    const board = await createBoard(request, token, 'Delete One Template Board');

    const keepTemplate = await createCardTemplate(request, token, board.id, 'Keep Me', 'Keeper');
    const deleteTemplate = await createCardTemplate(request, token, board.id, 'Delete Me', 'Goner');

    await request.delete(`${BASE}/api/boards/${board.id}/templates/${deleteTemplate.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const templates = await listCardTemplates(request, token, board.id);
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe(keepTemplate.id);
    expect(templates[0].name).toBe('Keep Me');
  });

  // -------------------------------------------------------------------------
  // Template name is required — empty name returns 400
  // -------------------------------------------------------------------------
  test('POST card template with empty name returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'ct-empty-name');
    const board = await createBoard(request, token, 'Empty Name Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: '', description_template: 'Valid description' },
    });
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // description_template is required — empty returns 400
  // -------------------------------------------------------------------------
  test('POST card template with empty description_template returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'ct-empty-desc');
    const board = await createBoard(request, token, 'Empty Desc Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Valid Name', description_template: '' },
    });
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Unauthorized POST returns 401
  // -------------------------------------------------------------------------
  test('POST card template without auth token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'ct-unauth');
    const board = await createBoard(request, token, 'Auth Test Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/templates`, {
      data: { name: 'Hacked Template', description_template: 'Should fail' },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Unauthorized GET returns 401
  // -------------------------------------------------------------------------
  test('GET card templates without auth token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'ct-unauth-get');
    const board = await createBoard(request, token, 'Auth GET Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/templates`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Template description with multiline markdown is stored correctly
  // -------------------------------------------------------------------------
  test('card template with multiline markdown description is stored as-is', async ({ request }) => {
    const { token } = await createUser(request, 'ct-markdown');
    const board = await createBoard(request, token, 'Markdown Template Board');

    const markdownDesc = '## Bug Report\n\n**Steps:**\n1. Open the app\n2. Click here\n\n**Expected:** X\n\n**Actual:** Y';
    const template = await createCardTemplate(
      request,
      token,
      board.id,
      'Markdown Template',
      markdownDesc,
    );

    expect(template.description_template).toBe(markdownDesc);

    // Verify via GET
    const templates = await listCardTemplates(request, token, board.id);
    expect(templates[0].description_template).toBe(markdownDesc);
  });

  // -------------------------------------------------------------------------
  // Template issue_type is empty string when not provided
  // -------------------------------------------------------------------------
  test('card template with no issue_type stores empty string', async ({ request }) => {
    const { token } = await createUser(request, 'ct-no-type');
    const board = await createBoard(request, token, 'No Issue Type Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Generic Template', description_template: 'Generic description' },
    });
    expect(res.status()).toBe(201);
    const template: CardTemplate = await res.json();
    // issue_type should be empty or absent when not provided
    expect(template.issue_type === '' || template.issue_type === undefined || template.issue_type === null).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Newly created template has correct board_id matching the board
  // -------------------------------------------------------------------------
  test('card template board_id matches the board it was created on', async ({ request }) => {
    const { token } = await createUser(request, 'ct-boardid');
    const board = await createBoard(request, token, 'Board ID Template Test');

    const template = await createCardTemplate(
      request,
      token,
      board.id,
      'Board ID Check',
      'Some template description',
    );

    expect(template.board_id).toBe(board.id);
  });

  // -------------------------------------------------------------------------
  // Template is scoped per board — other boards do not see it
  // -------------------------------------------------------------------------
  test('card template created on one board does not appear on another board', async ({ request }) => {
    const { token } = await createUser(request, 'ct-scope');
    const boardA = await createBoard(request, token, 'Board A Templates');
    const boardB = await createBoard(request, token, 'Board B Templates');

    await createCardTemplate(request, token, boardA.id, 'Template Only For A', 'A-only description');

    const templatesOnB = await listCardTemplates(request, token, boardB.id);
    expect(templatesOnB.some((t) => t.name === 'Template Only For A')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Card template UI tests (marked as fixme — UI may not exist yet)
// ---------------------------------------------------------------------------

test.describe('Card Templates — UI (fixme: UI may not be implemented)', () => {
  test.fixme('template section visible in board settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-settings');
    const board = await createBoard(request, token, 'UI Settings Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('.settings-section').filter({ hasText: /template/i }),
    ).toBeVisible();
  });

  test.fixme('add template button present in board settings templates section', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-add-btn');
    const board = await createBoard(request, token, 'Add Btn Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('button').filter({ hasText: /add template|new template|create template/i }),
    ).toBeVisible();
  });

  test.fixme('template form has name and issue_type fields', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-form-fields');
    const board = await createBoard(request, token, 'Form Fields Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await page.locator('button').filter({ hasText: /add template|create template/i }).click();

    await expect(page.locator('input[name="name"], #templateName')).toBeVisible();
    await expect(
      page.locator('select[name="issue_type"], #templateIssueType'),
    ).toBeVisible();
    await expect(
      page.locator('textarea[name="description_template"], #templateDescription'),
    ).toBeVisible();
  });

  test.fixme('created template appears in board settings list', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-appears');
    const board = await createBoard(request, token, 'Appears Board');
    await createCardTemplate(request, token, board.id, 'Visible Template', 'A visible description');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('.template-item, [data-testid="template-item"]').filter({ hasText: 'Visible Template' }),
    ).toBeVisible();
  });

  test.fixme('delete template button present on each template in settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-del-btn');
    const board = await createBoard(request, token, 'Del Btn Board');
    await createCardTemplate(request, token, board.id, 'Deletable Template', 'Some description');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('.template-item button[aria-label*="delete" i], .template-item .btn-delete'),
    ).toBeVisible();
  });

  test.fixme('template usable when creating a new card', async ({ page, request }) => {
    const { token } = await createUser(request, 'ct-ui-use-template');
    const board = await createBoard(request, token, 'Use Template Board', 'kanban');
    const templateDesc = '## Steps to Reproduce\n\n## Expected\n\n## Actual';
    await createCardTemplate(request, token, board.id, 'Bug Report', templateDesc);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Open the "new card" form in the first column
    await page.locator('.add-card-btn, button:has-text("Add Card")').first().click();
    // A template selector or "Use Template" button should appear
    await expect(
      page.locator('select[name="template"], button:has-text("Template"), [data-testid="template-select"]'),
    ).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Board export (CSV) tests
// ---------------------------------------------------------------------------

test.describe('Board Export — CSV', () => {
  test('GET /api/boards/:id/export with valid token returns CSV content', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-export');
    const board = await createBoard(request, token, 'Export Board');

    const res = await request.get(
      `${BASE}/api/boards/${board.id}/export?token=${token}`,
    );
    expect(res.ok()).toBe(true);

    const contentType = res.headers()['content-type'];
    expect(contentType).toMatch(/text\/csv|application\/octet-stream/i);
  });

  test('GET /api/boards/:id/export without token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-export-unauth');
    const board = await createBoard(request, token, 'Unauth Export Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/boards/:id/export with invalid token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-export-bad-token');
    const board = await createBoard(request, token, 'Bad Token Export Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=invalid-token-xyz`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/boards/:id/export CSV contains header row', async ({ request }) => {
    const { token } = await createUser(request, 'tpl-export-csv');
    const board = await createBoard(request, token, 'CSV Header Board');

    const res = await request.get(
      `${BASE}/api/boards/${board.id}/export?token=${token}`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.text();
    // CSV should have at least one line (the header)
    expect(body.length).toBeGreaterThan(0);
    const lines = body.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // Header should mention common card fields
    expect(lines[0].toLowerCase()).toMatch(/id|title|status|column/i);
  });
});
