import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

async function createUser(request: any, displayName = 'Test User', prefix = 'bs') {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string } };
}

async function createBoard(request: any, token: string, name = 'Settings Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string; columns?: any[]; swimlanes?: any[] };
}

// ---------------------------------------------------------------------------
// 1. General settings — page load & structure
// ---------------------------------------------------------------------------

test.describe('Board Settings — page structure', () => {
  test('loads settings page with all expected sections', async ({ page, request }) => {
    const { token } = await createUser(request, 'Section User', 'bs-struct');
    const board = await createBoard(request, token, 'Struct Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.page-header h1')).toContainText('Board Settings');

    // All expected sections must be present
    for (const heading of ['General', 'Columns', 'Labels', 'Members']) {
      await expect(page.locator(`.settings-section h2:has-text("${heading}")`)).toBeVisible();
    }
  });

  test('settings page shows board name pre-filled in the input', async ({ page, request }) => {
    const { token } = await createUser(request, 'Prefill User', 'bs-prefill');
    const board = await createBoard(request, token, 'PreFilled Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('#boardName')).toHaveValue('PreFilled Board', { timeout: 8000 });
  });

  test('back link navigates to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'BackLink User', 'bs-back');
    const board = await createBoard(request, token, 'Back Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await page.locator('.back-link').click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`), { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 2. General settings — rename & description
// ---------------------------------------------------------------------------

test.describe('Board Settings — rename and description', () => {
  test('renames the board and change is visible on the boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Rename User', 'bs-rename');
    const board = await createBoard(request, token, 'Rename Me');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const nameInput = page.locator('#boardName');
    await nameInput.clear();
    await nameInput.fill('Renamed Board');

    const saveBtn = page.locator('button:has-text("Save Changes")');
    await saveBtn.click();
    await expect(saveBtn).toHaveText('Save Changes', { timeout: 5000 });

    await page.goto('/boards');
    await expect(page.locator('.board-card h3:has-text("Renamed Board")')).toBeVisible({ timeout: 8000 });
  });

  test('updates board description and it persists after reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'Desc User', 'bs-desc');
    const board = await createBoard(request, token, 'Desc Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const descInput = page.locator('#boardDesc');
    await descInput.clear();
    await descInput.fill('Updated board description');

    await page.locator('button:has-text("Save Changes")').click();
    await expect(page.locator('button:has-text("Save Changes")')).toHaveText('Save Changes', { timeout: 5000 });

    await page.reload();
    await expect(page.locator('#boardDesc')).toHaveValue('Updated board description', { timeout: 8000 });
  });

  test('API PUT /api/boards/:id persists the new name', async ({ request }) => {
    const { token } = await createUser(request, 'API Rename', 'bs-api-rename');
    const board = await createBoard(request, token, 'API Rename Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Renamed', description: '' },
    });
    expect(res.status()).toBe(200);

    const verify = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await verify.json();
    expect(body.name).toBe('API Renamed');
  });
});

// ---------------------------------------------------------------------------
// 3. Delete board
// ---------------------------------------------------------------------------

test.describe('Board Settings — delete board', () => {
  test('deletes the board and redirects to boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Delete User', 'bs-del');
    const board = await createBoard(request, token, 'Delete Me Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    page.once('dialog', (d) => d.accept());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    await page.waitForURL(/\/boards$/, { timeout: 8000 });
    await expect(page.locator('.board-card h3:has-text("Delete Me Board")')).not.toBeVisible();
  });

  test('cancelling the delete confirmation keeps the board intact', async ({ page, request }) => {
    const { token } = await createUser(request, 'Cancel Delete User', 'bs-cancel-del');
    const board = await createBoard(request, token, 'Keep Me Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    page.once('dialog', (d) => d.dismiss());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    // Should stay on the settings page — board was not deleted
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#boardName')).toHaveValue('Keep Me Board');
  });

  test('API DELETE /api/boards/:id returns 204', async ({ request }) => {
    const { token } = await createUser(request, 'API Del User', 'bs-api-del');
    const board = await createBoard(request, token, 'API Delete Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(204);

    // Subsequent GET should return 404
    const verify = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(verify.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 4. Column management
// ---------------------------------------------------------------------------

test.describe('Board Settings — columns', () => {
  test('default columns (To Do, In Progress, Done) are visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col Defaults', 'bs-col-def');
    const board = await createBoard(request, token, 'Col Default Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();
    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
  });

  test('adds a new column via the Add Column modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Col User', 'bs-add-col');
    const board = await createBoard(request, token, 'Add Col Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('In Review');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("In Review")')).toBeVisible({ timeout: 8000 });
  });

  test('adds a column with a specific state (closed)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col State User', 'bs-col-state');
    const board = await createBoard(request, token, 'Col State Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('Closed Column');
    await page.locator('.modal select').selectOption('closed');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    // Verify the new column shows the correct state
    const newColRow = columnsSection.locator('.settings-list-item').filter({ hasText: 'Closed Column' });
    await expect(newColRow).toBeVisible({ timeout: 8000 });
    await expect(newColRow.locator('.item-meta')).toContainText('closed');
  });

  test('deletes a column after confirming the dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Del Col User', 'bs-del-col');
    const board = await createBoard(request, token, 'Del Col Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });

    // Add a column to delete
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Trash Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Trash Column")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Trash Column' })
      .locator('.item-delete')
      .click();

    await expect(columnsSection.locator('.item-name:has-text("Trash Column")')).not.toBeVisible({ timeout: 8000 });
  });

  test('reorders columns with the up/down buttons', async ({ page, request }) => {
    const { token } = await createUser(request, 'Reorder User', 'bs-reorder');
    const board = await createBoard(request, token, 'Reorder Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');

    const firstNameBefore = await items.nth(0).locator('.item-name').textContent();
    const secondNameBefore = await items.nth(1).locator('.item-name').textContent();

    // Move the first column down — should swap positions 0 and 1
    await items.nth(0).locator('.reorder-btn[title="Move down"]').click();

    await expect(items.nth(0).locator('.item-name')).toHaveText(secondNameBefore!, { timeout: 5000 });
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstNameBefore!, { timeout: 5000 });
  });

  test('column state is shown in the item-meta span', async ({ page, request }) => {
    const { token } = await createUser(request, 'State Meta User', 'bs-state-meta');
    const board = await createBoard(request, token, 'State Meta Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    // Each column row should show its state in .item-meta
    const firstItemMeta = columnsSection.locator('.settings-list-item').first().locator('.item-meta');
    await expect(firstItemMeta).toBeVisible({ timeout: 8000 });
    const metaText = await firstItemMeta.textContent();
    expect(metaText).toMatch(/State:/i);
  });

  test('API: create column returns 201 with correct state', async ({ request }) => {
    const { token } = await createUser(request, 'API Col User', 'bs-api-col');
    const board = await createBoard(request, token, 'API Col Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Column', state: 'in_progress' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('API Column');
    expect(body.state).toBe('in_progress');
  });

  test.fixme('rename a column inline via the settings UI', async ({ page, request }) => {
    // The column list does not currently expose an edit/rename button or
    // inline input — mark fixme until the UI adds inline column renaming.
    const { token } = await createUser(request, 'Rename Col User', 'bs-rename-col');
    const board = await createBoard(request, token, 'Rename Col Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const firstRow = columnsSection.locator('.settings-list-item').first();
    await firstRow.locator('.item-edit').click();

    const editInput = page.locator('.modal input[type="text"]');
    await editInput.clear();
    await editInput.fill('Renamed Column');
    await page.locator('.modal button[type="submit"]').click();
    await expect(columnsSection.locator('.item-name:has-text("Renamed Column")')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Swimlane management
// ---------------------------------------------------------------------------

test.describe('Board Settings — swimlanes', () => {
  test('swimlanes section is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane Vis', 'bs-sl-vis');
    const board = await createBoard(request, token, 'Swimlane Vis Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-section h2:has-text("Swimlanes")')).toBeVisible({ timeout: 8000 });
  });

  test('API: create swimlane returns 201 and it appears in settings list', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Swimlane Add', 'bs-sl-add');
    const board = await createBoard(request, token, 'Swimlane Add Board');

    // Create swimlane via API
    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Lane', designator: 'AL-', color: '#2196F3' },
    });
    expect(slRes.status()).toBe(201);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("API Lane")')).toBeVisible({ timeout: 8000 });
  });

  test('deletes a swimlane via the UI', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane Del', 'bs-sl-del');
    const board = await createBoard(request, token, 'Swimlane Del Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete Lane', designator: 'DL-', color: '#f44336' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("Delete Lane")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await swimlanesSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Delete Lane' })
      .locator('.item-delete')
      .click();

    await expect(swimlanesSection.locator('.item-name:has-text("Delete Lane")')).not.toBeVisible({ timeout: 8000 });
  });

  test('swimlane row shows designator in item-meta', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Meta User', 'bs-sl-meta');
    const board = await createBoard(request, token, 'SL Meta Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Meta Lane', designator: 'ML-', color: '#9c27b0' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Meta Lane' });
    await expect(slRow.locator('.item-meta')).toContainText('ML-', { timeout: 8000 });
  });

  test.fixme('edit swimlane name via the settings UI', async ({ page, request }) => {
    // There is no edit button on swimlane rows in the current UI.
    // Mark fixme until the feature is added.
  });
});

// ---------------------------------------------------------------------------
// 6. Label management
// ---------------------------------------------------------------------------

test.describe('Board Settings — labels', () => {
  test('adds a new label', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Label User', 'bs-add-lbl');
    const board = await createBoard(request, token, 'Add Label Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();

    await expect(page.locator('.modal h2:has-text("Add Label")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('Bug');
    await page.locator('.modal .color-option').nth(1).click();
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Bug")')).toBeVisible({ timeout: 8000 });
  });

  test('edits an existing label', async ({ page, request }) => {
    const { token } = await createUser(request, 'Edit Label User', 'bs-edit-lbl');
    const board = await createBoard(request, token, 'Edit Label Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    // Create a label first
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Original');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Original")')).toBeVisible({ timeout: 8000 });

    // Edit it
    await labelsSection.locator('.settings-list-item').filter({ hasText: 'Original' }).locator('.item-edit').click();
    await expect(page.locator('.modal h2:has-text("Edit Label")')).toBeVisible();

    const nameInput = page.locator('.modal input[type="text"]');
    await nameInput.clear();
    await nameInput.fill('Feature');
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Feature")')).toBeVisible({ timeout: 8000 });
    await expect(labelsSection.locator('.item-name:has-text("Original")')).not.toBeVisible();
  });

  test('deletes a label after confirming', async ({ page, request }) => {
    const { token } = await createUser(request, 'Del Label User', 'bs-del-lbl');
    const board = await createBoard(request, token, 'Del Label Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Temp Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Temp Label")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Temp Label' })
      .locator('.item-delete')
      .click();

    await expect(labelsSection.locator('.item-name:has-text("Temp Label")')).not.toBeVisible({ timeout: 8000 });
  });

  test('API: create label returns 201', async ({ request }) => {
    const { token } = await createUser(request, 'API Label User', 'bs-api-lbl');
    const board = await createBoard(request, token, 'API Label Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Label', color: '#ef4444' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('API Label');
  });
});

// ---------------------------------------------------------------------------
// 7. Export to CSV
// ---------------------------------------------------------------------------

test.describe('Board Settings — export to CSV', () => {
  test('API GET /api/boards/:id/export returns a CSV file for a board member', async ({ request }) => {
    const { token } = await createUser(request, 'Export User', 'bs-export');
    const board = await createBoard(request, token, 'Export Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.status()).toBe(200);

    const contentType = res.headers()['content-type'];
    expect(contentType).toMatch(/text\/csv/);

    const text = await res.text();
    // CSV should contain the standard header row
    expect(text).toMatch(/ID,Title/);
  });

  test('API GET /api/boards/:id/export with no token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'Export Auth User', 'bs-export-auth');
    const board = await createBoard(request, token, 'Export Auth Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export`);
    expect(res.status()).toBe(401);
  });

  test('Export to CSV button is visible in Import/Export section', async ({ page, request }) => {
    const { token } = await createUser(request, 'Export Btn User', 'bs-export-btn');
    const board = await createBoard(request, token, 'Export Btn Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-section h2:has-text("Import / Export")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('button:has-text("Export to CSV")')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. Danger zone
// ---------------------------------------------------------------------------

test.describe('Board Settings — danger zone', () => {
  test('danger zone section is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Danger User', 'bs-danger');
    const board = await createBoard(request, token, 'Danger Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-section.danger')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.settings-section.danger h2:has-text("Danger Zone")')).toBeVisible();
    await expect(page.locator('button.btn-danger:has-text("Delete Board")')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 9. Gitea / Workflow settings
// ---------------------------------------------------------------------------

test.describe('Board Settings — workflow rules', () => {
  test('workflow rules section is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Workflow User', 'bs-wf');
    const board = await createBoard(request, token, 'Workflow Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-section h2:has-text("Workflow Rules")')).toBeVisible({ timeout: 8000 });
  });

  test('enabling workflow rules shows the matrix', async ({ page, request }) => {
    const { token } = await createUser(request, 'Workflow Toggle User', 'bs-wf-toggle');
    const board = await createBoard(request, token, 'Workflow Toggle Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    await expect(toggle).toBeVisible({ timeout: 8000 });

    // Enable it
    const isChecked = await toggle.isChecked();
    if (!isChecked) {
      await toggle.click();
    }

    // Matrix should become visible when workflow is enabled and there are columns
    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5000 });
  });

  test('Save Workflow Rules button is present when workflow enabled', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Save User', 'bs-wf-save');
    const board = await createBoard(request, token, 'WF Save Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    const isChecked = await toggle.isChecked();
    if (!isChecked) await toggle.click();

    await expect(page.locator('button:has-text("Save Workflow Rules")')).toBeVisible({ timeout: 5000 });
  });
});
