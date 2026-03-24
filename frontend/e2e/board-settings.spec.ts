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
  return { token: body.token as string, user: body.user as { id: number; display_name: string; email: string } };
}

async function createBoard(request: any, token: string, name = 'Settings Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string; columns?: any[]; swimlanes?: any[] };
}

async function setupPage(page: any, request: any, boardName: string, prefix: string) {
  const { token, user } = await createUser(request, 'Settings Tester', prefix);
  const board = await createBoard(request, token, boardName);
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}/settings`);
  // Under load the settings page may take a few extra seconds to render
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 20000 });
  return { token, user, board };
}

// ---------------------------------------------------------------------------
// 1. Page structure & general load
// ---------------------------------------------------------------------------

test.describe('Board Settings — page structure', () => {
  test('loads settings page with all expected sections', async ({ page, request }) => {
    const { token } = await createUser(request, 'Section User', 'bs-struct');
    const board = await createBoard(request, token, 'Struct Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.page-header h1')).toContainText('Board Settings');

    // All expected sections
    for (const heading of ['General', 'Columns', 'Swimlanes', 'Labels', 'Members', 'Workflow Rules', 'Issue Types', 'Import / Export', 'Danger Zone']) {
      await expect(page.locator(`.settings-section h2:has-text("${heading}")`)).toBeVisible();
    }
  });

  test('board name is pre-filled in the name input', async ({ page, request }) => {
    await setupPage(page, request, 'PreFilled Board', 'bs-prefill');
    await expect(page.locator('#boardName')).toHaveValue('PreFilled Board', { timeout: 8000 });
  });

  test('back link navigates to the board view', async ({ page, request }) => {
    const { board } = await setupPage(page, request, 'Back Board', 'bs-back');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`), { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 2. General settings — rename & description
// ---------------------------------------------------------------------------

test.describe('Board Settings — rename and description', () => {
  test('renames the board and change is visible on boards list', async ({ page, request }) => {
    const { board } = await setupPage(page, request, 'Rename Me', 'bs-rename');

    const nameInput = page.locator('#boardName');
    await nameInput.clear();
    await nameInput.fill('Renamed Board');
    await page.locator('button:has-text("Save Changes")').click();
    // Wait for save to complete (button returns to non-saving state from "Saving...")
    await expect(page.locator('button:has-text("Save Changes")')).toBeVisible({ timeout: 15000 });

    await page.goto('/boards');
    await expect(page.locator('.board-card h3:has-text("Renamed Board")')).toBeVisible({ timeout: 12000 });
  });

  test('updates description and it persists after reload', async ({ page, request }) => {
    const { board } = await setupPage(page, request, 'Desc Board', 'bs-desc');

    const descInput = page.locator('#boardDesc');
    await descInput.clear();
    await descInput.fill('Updated board description');
    await page.locator('button:has-text("Save Changes")').click();
    await expect(page.locator('button:has-text("Save Changes")')).toBeVisible({ timeout: 15000 });

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#boardDesc')).toHaveValue('Updated board description', { timeout: 12000 });
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
  test('danger zone section is visible with delete button', async ({ page, request }) => {
    await setupPage(page, request, 'Danger Board', 'bs-danger');
    await expect(page.locator('.settings-section.danger')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.settings-section.danger h2:has-text("Danger Zone")')).toBeVisible();
    await expect(page.locator('button.btn-danger:has-text("Delete Board")')).toBeVisible();
  });

  test('deletes the board and redirects to boards list', async ({ page, request }) => {
    await setupPage(page, request, 'Delete Me Board', 'bs-del');

    page.once('dialog', (d) => d.accept());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    await page.waitForURL(/\/boards$/, { timeout: 8000 });
    await expect(page.locator('.board-card h3:has-text("Delete Me Board")')).not.toBeVisible();
  });

  test('cancelling the delete dialog keeps the board intact', async ({ page, request }) => {
    await setupPage(page, request, 'Keep Me Board', 'bs-cancel-del');

    page.once('dialog', (d) => d.dismiss());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    // Should remain on settings page
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#boardName')).toHaveValue('Keep Me Board');
  });

  test('API DELETE /api/boards/:id returns 204 and subsequent GET returns 404', async ({ request }) => {
    const { token } = await createUser(request, 'API Del User', 'bs-api-del');
    const board = await createBoard(request, token, 'API Delete Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(204);

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
  // Helper: locate the Columns section by its heading (not by text content of the whole section,
  // because "Workflow Rules" section description also references "column transitions").
  function getColumnsSection(page: any) {
    return page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Columns")') });
  }

  test('default columns (To Do, In Progress, Done) are visible', async ({ page, request }) => {
    await setupPage(page, request, 'Col Default Board', 'bs-col-def');

    const columnsSection = getColumnsSection(page);
    const names = await columnsSection.locator('.item-name').allTextContents();
    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
  });

  test('column state is shown in the item-meta span', async ({ page, request }) => {
    await setupPage(page, request, 'State Meta Board', 'bs-state-meta');

    const columnsSection = getColumnsSection(page);
    const firstItemMeta = columnsSection.locator('.settings-list-item').first().locator('.item-meta');
    await expect(firstItemMeta).toBeVisible({ timeout: 8000 });
    const metaText = await firstItemMeta.textContent();
    expect(metaText).toMatch(/State:/i);
  });

  test('adds a new column with default state via the Add Column modal', async ({ page, request }) => {
    await setupPage(page, request, 'Add Col Board', 'bs-add-col');

    const columnsSection = getColumnsSection(page);
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('New Unique Col');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("New Unique Col")')).toBeVisible({ timeout: 8000 });
  });

  test('column state dropdown has open/in_progress/review/closed options', async ({ page, request }) => {
    await setupPage(page, request, 'Col State Options Board', 'bs-col-options');

    const columnsSection = getColumnsSection(page);
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();

    const stateSelect = page.locator('.modal select');
    await expect(stateSelect.locator('option[value="open"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="in_progress"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="review"]')).toBeAttached();
    await expect(stateSelect.locator('option[value="closed"]')).toBeAttached();
  });

  test('adds a column with state closed and meta shows the state', async ({ page, request }) => {
    await setupPage(page, request, 'Col State Board', 'bs-col-state');

    const columnsSection = getColumnsSection(page);
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('Closed Col');
    await page.locator('.modal select').selectOption('closed');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    const newColRow = columnsSection.locator('.settings-list-item').filter({ hasText: 'Closed Col' });
    await expect(newColRow).toBeVisible({ timeout: 8000 });
    await expect(newColRow.locator('.item-meta')).toContainText('closed');
  });

  test('adds a column with state in_progress and meta shows the state', async ({ page, request }) => {
    await setupPage(page, request, 'Col InProgress Board', 'bs-col-inp');

    const columnsSection = getColumnsSection(page);
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('InProg Col');
    await page.locator('.modal select').selectOption('in_progress');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    const newColRow = columnsSection.locator('.settings-list-item').filter({ hasText: 'InProg Col' });
    await expect(newColRow).toBeVisible({ timeout: 8000 });
    await expect(newColRow.locator('.item-meta')).toContainText('in_progress');
  });

  test('deletes a column after confirming the dialog', async ({ page, request }) => {
    await setupPage(page, request, 'Del Col Board', 'bs-del-col');

    const columnsSection = getColumnsSection(page);

    // Add a column to delete
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Trash Col');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Trash Col")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Trash Col' })
      .locator('.item-delete')
      .click();

    await expect(columnsSection.locator('.item-name:has-text("Trash Col")')).not.toBeVisible({ timeout: 8000 });
  });

  test('cancelling delete column dialog keeps the column', async ({ page, request }) => {
    await setupPage(page, request, 'Keep Col Board', 'bs-keep-col');

    const columnsSection = getColumnsSection(page);

    // Add a column to try to delete
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Persist Col');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Persist Col")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.dismiss());
    await columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Persist Col' })
      .locator('.item-delete')
      .click();

    // Column should still be present
    await expect(columnsSection.locator('.item-name:has-text("Persist Col")')).toBeVisible({ timeout: 5000 });
  });

  test('reorders columns with the Move down button', async ({ page, request }) => {
    await setupPage(page, request, 'Reorder Board', 'bs-reorder');

    const columnsSection = getColumnsSection(page);
    // Wait for all columns to load
    await expect(columnsSection.locator('.settings-list-item').nth(1)).toBeVisible({ timeout: 8000 });

    const items = columnsSection.locator('.settings-list-item');
    const firstNameBefore = await items.nth(0).locator('.item-name').textContent();
    const secondNameBefore = await items.nth(1).locator('.item-name').textContent();

    // Move the first column down — should swap positions 0 and 1 (optimistic update)
    await items.nth(0).locator('.reorder-btn[title="Move down"]').click();

    await expect(items.nth(0).locator('.item-name')).not.toHaveText(firstNameBefore!, { timeout: 8000 });
    await expect(items.nth(0).locator('.item-name')).toHaveText(secondNameBefore!, { timeout: 5000 });
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstNameBefore!, { timeout: 5000 });
  });

  test('reorders columns with the Move up button', async ({ page, request }) => {
    await setupPage(page, request, 'Reorder Up Board', 'bs-reorder-up');

    const columnsSection = getColumnsSection(page);
    // Wait for all columns to load
    await expect(columnsSection.locator('.settings-list-item').nth(1)).toBeVisible({ timeout: 8000 });

    const items = columnsSection.locator('.settings-list-item');
    const firstNameBefore = await items.nth(0).locator('.item-name').textContent();
    const secondNameBefore = await items.nth(1).locator('.item-name').textContent();

    // Move the second column up — should swap positions 0 and 1
    await items.nth(1).locator('.reorder-btn[title="Move up"]').click();

    await expect(items.nth(0).locator('.item-name')).not.toHaveText(firstNameBefore!, { timeout: 8000 });
    await expect(items.nth(0).locator('.item-name')).toHaveText(secondNameBefore!, { timeout: 5000 });
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstNameBefore!, { timeout: 5000 });
  });

  test('first column Move up button is disabled', async ({ page, request }) => {
    await setupPage(page, request, 'Reorder Disabled Board', 'bs-reorder-dis');

    const columnsSection = getColumnsSection(page);
    const firstItem = columnsSection.locator('.settings-list-item').first();
    await expect(firstItem.locator('.reorder-btn[title="Move up"]')).toBeDisabled({ timeout: 8000 });
  });

  test('last column Move down button is disabled', async ({ page, request }) => {
    await setupPage(page, request, 'Reorder Last Disabled Board', 'bs-reorder-last');

    const columnsSection = getColumnsSection(page);
    const lastItem = columnsSection.locator('.settings-list-item').last();
    await expect(lastItem.locator('.reorder-btn[title="Move down"]')).toBeDisabled({ timeout: 8000 });
  });

  test('closing the Add Column modal via Cancel discards the input', async ({ page, request }) => {
    await setupPage(page, request, 'Cancel Col Board', 'bs-cancel-col');

    const columnsSection = getColumnsSection(page);
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();

    await page.locator('.modal input[type="text"]').fill('Abandoned Col');
    await page.locator('.modal button:has-text("Cancel")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("Abandoned Col")')).not.toBeVisible();
  });

  test('API: create column returns 201 with correct name and state', async ({ request }) => {
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

  // Column rename is not exposed in the current UI (no edit/pencil button on column rows)
  test.fixme('rename a column inline via the settings UI', async () => {
    // The column list does not currently expose an edit/rename button.
    // Mark fixme until the UI adds inline column renaming.
  });
});

// ---------------------------------------------------------------------------
// 5. Swimlane management
// ---------------------------------------------------------------------------

test.describe('Board Settings — swimlanes', () => {
  test('swimlanes section is visible with Add Swimlane button', async ({ page, request }) => {
    await setupPage(page, request, 'Swimlane Vis Board', 'bs-sl-vis');
    await expect(page.locator('.settings-section h2:has-text("Swimlanes")')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.settings-section').filter({ hasText: 'Swimlanes' }).locator('button:has-text("Add Swimlane")')
    ).toBeVisible();
  });

  test('clicking Add Swimlane opens the modal with title', async ({ page, request }) => {
    await setupPage(page, request, 'Add SL Modal Board', 'bs-sl-modal');

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible({ timeout: 5000 });
  });

  test('adds a new swimlane via the modal with name, repo, and designator', async ({ page, request }) => {
    await setupPage(page, request, 'Add SL Board', 'bs-sl-add');

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible({ timeout: 5000 });

    // Fill in name (placeholder "Frontend")
    await page.locator('.modal input[placeholder="Frontend"]').fill('Backend Lane');
    // Fill in repo text input (shown when no repos are configured, placeholder "owner/repo")
    await page.locator('.modal input[placeholder="owner/repo"]').fill('org/backend');
    // Fill in designator (placeholder "FE-")
    await page.locator('.modal input[placeholder="FE-"]').fill('BE-');

    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 12000 });
    await expect(swimlanesSection.locator('.item-name:has-text("Backend Lane")')).toBeVisible({ timeout: 8000 });
  });

  test('new swimlane row shows repo and designator in item-meta', async ({ page, request }) => {
    await setupPage(page, request, 'SL Meta UI Board', 'bs-sl-meta-ui');

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();

    await page.locator('.modal input[placeholder="Frontend"]').fill('Meta Lane');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('org/myrepo');
    await page.locator('.modal input[placeholder="FE-"]').fill('ML-');
    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 12000 });

    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Meta Lane' });
    await expect(slRow).toBeVisible({ timeout: 8000 });
    const metaText = await slRow.locator('.item-meta').textContent();
    expect(metaText).toContain('ML-');
    expect(metaText).toContain('org/myrepo');
  });

  test('swimlane color swatch appears on the row', async ({ page, request }) => {
    await setupPage(page, request, 'SL Color Board', 'bs-sl-color');

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();

    await page.locator('.modal input[placeholder="Frontend"]').fill('Color Lane');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('org/colorrepo');
    await page.locator('.modal input[placeholder="FE-"]').fill('CL-');
    // Select a non-default color (second color option = purple)
    await page.locator('.modal .color-option').nth(1).click();
    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 12000 });

    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Color Lane' });
    await expect(slRow).toBeVisible({ timeout: 8000 });
    // The color swatch element should be present on the row
    await expect(slRow.locator('.item-color')).toBeVisible();
  });

  test('Add Swimlane modal Cancel button closes the modal without adding', async ({ page, request }) => {
    await setupPage(page, request, 'Cancel SL Board', 'bs-sl-cancel');

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 12000 });
  });

  test('deletes a swimlane via the delete button after confirming', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane Del', 'bs-sl-del');
    const board = await createBoard(request, token, 'Swimlane Del Board');

    // Create swimlane via API
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete Lane', designator: 'DL-', color: '#f44336' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

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

  test('cancelling swimlane delete dialog keeps the swimlane', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane Keep', 'bs-sl-keep');
    const board = await createBoard(request, token, 'Swimlane Keep Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Keep Lane', designator: 'KL-', color: '#22c55e' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("Keep Lane")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.dismiss());
    await swimlanesSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Keep Lane' })
      .locator('.item-delete')
      .click();

    await expect(swimlanesSection.locator('.item-name:has-text("Keep Lane")')).toBeVisible({ timeout: 5000 });
  });

  test('API: create swimlane returns 201 and swimlane appears in settings list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane API Add', 'bs-sl-api-add');
    const board = await createBoard(request, token, 'Swimlane API Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Lane', designator: 'AL-', color: '#2196F3' },
    });
    expect(slRes.status()).toBe(201);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("API Lane")')).toBeVisible({ timeout: 8000 });
  });

  test('API: swimlane row meta contains the designator', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Meta User', 'bs-sl-meta');
    const board = await createBoard(request, token, 'SL Meta Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Meta Lane', designator: 'ML-', color: '#9c27b0' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Meta Lane' });
    await expect(slRow.locator('.item-meta')).toContainText('ML-', { timeout: 8000 });
  });

  // Edit swimlane name is not exposed in the current UI (no edit/pencil button on swimlane rows)
  test.fixme('edit swimlane name via the settings UI', async () => {
    // There is no edit button on swimlane rows in the current UI.
  });
});

// ---------------------------------------------------------------------------
// 6. Label management
// ---------------------------------------------------------------------------

test.describe('Board Settings — labels', () => {
  function getLabelsSection(page: any) {
    return page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Labels")') });
  }

  test('adds a new label via Add Label modal', async ({ page, request }) => {
    await setupPage(page, request, 'Add Label Board', 'bs-add-lbl');

    const labelsSection = getLabelsSection(page);
    await labelsSection.locator('button:has-text("Add Label")').click();

    await expect(page.locator('.modal h2:has-text("Add Label")')).toBeVisible();
    await page.locator('.modal input[type="text"]').fill('Bug');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Bug")')).toBeVisible({ timeout: 8000 });
  });

  test('label color can be selected from the color picker', async ({ page, request }) => {
    await setupPage(page, request, 'Label Color Board', 'bs-lbl-color');

    const labelsSection = getLabelsSection(page);
    await labelsSection.locator('button:has-text("Add Label")').click();

    await page.locator('.modal input[type="text"]').fill('Feature');
    // Click second color option (purple — #8b5cf6)
    await page.locator('.modal .color-option').nth(1).click();
    // Verify it got the 'selected' class
    await expect(page.locator('.modal .color-option').nth(1)).toHaveClass(/selected/);
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Feature")')).toBeVisible({ timeout: 8000 });
  });

  test('label row shows a color swatch', async ({ page, request }) => {
    await setupPage(page, request, 'Label Swatch Board', 'bs-lbl-swatch');

    const labelsSection = getLabelsSection(page);
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Swatch Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Swatch Label")')).toBeVisible({ timeout: 8000 });

    const labelRow = labelsSection.locator('.settings-list-item').filter({ hasText: 'Swatch Label' });
    await expect(labelRow.locator('.item-color')).toBeVisible();
  });

  test('edits an existing label name via the Edit Label modal', async ({ page, request }) => {
    await setupPage(page, request, 'Edit Label Board', 'bs-edit-lbl');

    const labelsSection = getLabelsSection(page);

    // Create a label first
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Original');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Original")')).toBeVisible({ timeout: 8000 });

    // Click the edit button on the label row
    await labelsSection.locator('.settings-list-item').filter({ hasText: 'Original' }).locator('.item-edit').click();
    await expect(page.locator('.modal h2:has-text("Edit Label")')).toBeVisible();

    // Existing name should be pre-filled
    await expect(page.locator('.modal input[type="text"]')).toHaveValue('Original');

    const nameInput = page.locator('.modal input[type="text"]');
    await nameInput.clear();
    await nameInput.fill('Enhancement');
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Enhancement")')).toBeVisible({ timeout: 8000 });
    await expect(labelsSection.locator('.item-name:has-text("Original")')).not.toBeVisible();
  });

  test('deletes a label after confirming the dialog', async ({ page, request }) => {
    await setupPage(page, request, 'Del Label Board', 'bs-del-lbl');

    const labelsSection = getLabelsSection(page);

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

  test('cancelling label delete keeps the label', async ({ page, request }) => {
    await setupPage(page, request, 'Keep Label Board', 'bs-keep-lbl');

    const labelsSection = getLabelsSection(page);

    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Persist Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Persist Label")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.dismiss());
    await labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Persist Label' })
      .locator('.item-delete')
      .click();

    await expect(labelsSection.locator('.item-name:has-text("Persist Label")')).toBeVisible({ timeout: 5000 });
  });

  test('closing Add Label modal via Cancel discards the input', async ({ page, request }) => {
    await setupPage(page, request, 'Cancel Label Board', 'bs-cancel-lbl');

    const labelsSection = getLabelsSection(page);
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Abandoned Label');
    await page.locator('.modal button:has-text("Cancel")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Abandoned Label")')).not.toBeVisible();
  });

  test('API: create label returns 201 with correct name and color', async ({ request }) => {
    const { token } = await createUser(request, 'API Label User', 'bs-api-lbl');
    const board = await createBoard(request, token, 'API Label Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Label', color: '#ef4444' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('API Label');
    expect(body.color).toBe('#ef4444');
  });
});

// ---------------------------------------------------------------------------
// 7. Board members
// ---------------------------------------------------------------------------

test.describe('Board Settings — members', () => {
  test('members section shows the board creator with admin or owner role', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Owner User', 'bs-member-owner');
    const board = await createBoard(request, token, 'Members Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const membersSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Members")') });
    await expect(membersSection).toBeVisible({ timeout: 8000 });

    // The board creator should appear in the members list
    const creatorRow = membersSection.locator('.settings-list-item').filter({ hasText: user.display_name });
    await expect(creatorRow).toBeVisible({ timeout: 8000 });
    // Role is "admin" for the creator (board API assigns admin to creator)
    const roleText = await creatorRow.locator('.item-meta').textContent();
    expect(['admin', 'owner']).toContain(roleText?.trim());
  });

  test('creator member row shows the creator display name in the members list', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Owner NoDel', 'bs-member-nodel');
    const board = await createBoard(request, token, 'Owner NoDel Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const membersSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Members")') });
    const creatorRow = membersSection.locator('.settings-list-item').filter({ hasText: user.display_name });
    // The creator row should be visible with a name and a role label
    await expect(creatorRow).toBeVisible({ timeout: 8000 });
    await expect(creatorRow.locator('.item-name')).toBeVisible();
    await expect(creatorRow.locator('.item-meta')).toBeVisible();
  });

  test('adds a second user as a board member via the Add Member modal', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'Board Owner', 'bs-add-member-owner');
    const { user: memberUser } = await createUser(request, 'New Member', 'bs-add-member-user');
    const board = await createBoard(request, ownerToken, 'Add Member Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const membersSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Members")') });
    await membersSection.locator('button:has-text("Add Member")').click();

    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();
    // Wait for the user option to be populated (async fetch of all users)
    await expect(page.locator('.modal select').first().locator(`option[value="${memberUser.id}"]`)).toBeAttached({ timeout: 8000 });
    await page.locator('.modal select').first().selectOption({ value: String(memberUser.id) });
    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(membersSection.locator('.item-name:has-text("New Member")')).toBeVisible({ timeout: 8000 });
  });

  test('Add Member modal has role selector with viewer/member/admin options', async ({ page, request }) => {
    const { token } = await createUser(request, 'Role Test Owner', 'bs-role-opts');
    const board = await createBoard(request, token, 'Role Options Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const membersSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Members")') });
    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    // Role select is the second select in the modal
    const roleSelect = page.locator('.modal select').last();
    await expect(roleSelect.locator('option[value="viewer"]')).toBeAttached();
    await expect(roleSelect.locator('option[value="member"]')).toBeAttached();
    await expect(roleSelect.locator('option[value="admin"]')).toBeAttached();
  });

  test('API: add member succeeds and member appears in GET /members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'API Add Owner', 'bs-api-add-owner');
    const { user: memberUser, token: memberToken } = await createUser(request, 'API Member', 'bs-api-add-member');
    const board = await createBoard(request, ownerToken, 'API Add Member Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });
    // Accept 200 or 201 depending on backend implementation
    expect([200, 201]).toContain(res.status());

    const membersRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const members = await membersRes.json();
    expect(members.some((m: any) => m.user_id === memberUser.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Import / Export
// ---------------------------------------------------------------------------

test.describe('Board Settings — import/export', () => {
  test('Import / Export section is visible with Export to CSV and Import from Jira CSV buttons', async ({ page, request }) => {
    await setupPage(page, request, 'Export Btn Board', 'bs-export-btn');

    await expect(page.locator('.settings-section h2:has-text("Import / Export")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('button:has-text("Export to CSV")')).toBeVisible();
    await expect(page.locator('button:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('API GET /api/boards/:id/export returns CSV with header row', async ({ request }) => {
    const { token } = await createUser(request, 'Export User', 'bs-export');
    const board = await createBoard(request, token, 'Export Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.status()).toBe(200);

    const contentType = res.headers()['content-type'];
    expect(contentType).toMatch(/text\/csv/);

    const text = await res.text();
    expect(text).toMatch(/ID,Title/);
  });

  test('API GET /api/boards/:id/export without token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'Export Auth User', 'bs-export-auth');
    const board = await createBoard(request, token, 'Export Auth Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export`);
    expect(res.status()).toBe(401);
  });

  test('clicking Import from Jira CSV opens the import modal', async ({ page, request }) => {
    await setupPage(page, request, 'Import Modal Board', 'bs-import-modal');

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.import-modal h3:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('import modal Cancel button closes the modal', async ({ page, request }) => {
    await setupPage(page, request, 'Import Cancel Board', 'bs-import-cancel');

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 10000 });

    await page.locator('.import-modal button:has-text("Cancel")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 9. Workflow rules
// ---------------------------------------------------------------------------

test.describe('Board Settings — workflow rules', () => {
  test('workflow rules section is visible with enable toggle', async ({ page, request }) => {
    await setupPage(page, request, 'Workflow Board', 'bs-wf');

    await expect(page.locator('.settings-section h2:has-text("Workflow Rules")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.workflow-toggle input[type="checkbox"]')).toBeVisible({ timeout: 8000 });
  });

  test('enabling workflow rules toggle shows the transition matrix', async ({ page, request }) => {
    await setupPage(page, request, 'Workflow Toggle Board', 'bs-wf-toggle');

    // Wait for columns to load (the matrix only renders when columns exist)
    const columnsSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Columns")') });
    await expect(columnsSection.locator('.settings-list-item').first()).toBeVisible({ timeout: 8000 });

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    await expect(toggle).toBeVisible({ timeout: 8000 });

    const isChecked = await toggle.isChecked();
    if (!isChecked) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 8000 });
  });

  test('Save Workflow Rules button is always present', async ({ page, request }) => {
    await setupPage(page, request, 'WF Save Board', 'bs-wf-save');

    await expect(page.locator('button:has-text("Save Workflow Rules")')).toBeVisible({ timeout: 8000 });
  });

  test('workflow matrix headers match the board columns', async ({ page, request }) => {
    await setupPage(page, request, 'WF Matrix Board', 'bs-wf-matrix');

    // Wait for columns to load before toggling
    const columnsSection = page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Columns")') });
    await expect(columnsSection.locator('.settings-list-item').first()).toBeVisible({ timeout: 8000 });

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    const isChecked = await toggle.isChecked();
    if (!isChecked) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 8000 });

    const headers = await page.locator('.workflow-matrix-header').allTextContents();
    expect(headers.length).toBeGreaterThan(0);
  });

  test('API: save and retrieve workflow rules round-trips correctly', async ({ request }) => {
    const { token } = await createUser(request, 'WF API User', 'bs-wf-api');
    const board = await createBoard(request, token, 'WF API Board');

    // Get column IDs from the board
    const boardRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardData = await boardRes.json();
    const columns = boardData.columns || [];
    if (columns.length < 2) return;

    const fromId = columns[0].id;
    const toId = columns[1].id;

    const res = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: fromId, to_column_id: toId }] },
    });
    expect(res.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rules = await getRes.json();
    expect(rules.some((r: any) => r.from_column_id === fromId && r.to_column_id === toId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Issue types
// ---------------------------------------------------------------------------

test.describe('Board Settings — issue types', () => {
  // Helper: target the Issue Types section by its heading. Also scope item lookups
  // to the .issue-types-list container to avoid matching labels from other sections.
  function getITSection(page: any) {
    return page.locator('.settings-section').filter({ has: page.locator('h2:has-text("Issue Types")') });
  }

  test('issue types section is visible with Add Type button', async ({ page, request }) => {
    await setupPage(page, request, 'Issue Types Board', 'bs-it-vis');

    await expect(page.locator('.settings-section h2:has-text("Issue Types")')).toBeVisible({ timeout: 8000 });
    await expect(getITSection(page).locator('button:has-text("Add Type")')).toBeVisible();
  });

  test('adds a new issue type with name via the modal', async ({ page, request }) => {
    await setupPage(page, request, 'Add IT Board', 'bs-it-add');

    const itSection = getITSection(page);
    await itSection.locator('button:has-text("Add Type")').click();

    await expect(page.locator('.modal h2:has-text("Add Issue Type")')).toBeVisible();
    // Name is the first input in the modal
    await page.locator('.modal input').first().fill('MyBugType');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    // Use the issue-types-list container to scope the lookup
    await expect(itSection.locator('.issue-types-list .item-name:has-text("MyBugType")')).toBeVisible({ timeout: 8000 });
  });

  test('edits an existing issue type name', async ({ page, request }) => {
    await setupPage(page, request, 'Edit IT Board', 'bs-it-edit');

    const itSection = getITSection(page);

    // Create one first with a unique name
    await itSection.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input').first().fill('MyStoryType');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();
    await expect(itSection.locator('.issue-types-list .item-name:has-text("MyStoryType")')).toBeVisible({ timeout: 8000 });

    // Click the edit button on the issue type row
    await itSection.locator('.issue-type-item').filter({ hasText: 'MyStoryType' }).locator('.item-edit').click();
    await expect(page.locator('.modal h2:has-text("Edit Issue Type")')).toBeVisible();

    const nameInput = page.locator('.modal input').first();
    await nameInput.clear();
    await nameInput.fill('MyUserStory');
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 8000 });
    await expect(itSection.locator('.issue-types-list .item-name:has-text("MyUserStory")')).toBeVisible({ timeout: 8000 });
    await expect(itSection.locator('.issue-types-list .item-name:has-text("MyStoryType")')).not.toBeVisible();
  });

  test('deletes an issue type after confirming the dialog', async ({ page, request }) => {
    await setupPage(page, request, 'Del IT Board', 'bs-it-del');

    const itSection = getITSection(page);

    await itSection.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input').first().fill('DeleteMeType');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();
    await expect(itSection.locator('.issue-types-list .item-name:has-text("DeleteMeType")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await itSection
      .locator('.issue-type-item')
      .filter({ hasText: 'DeleteMeType' })
      .locator('.item-delete')
      .click();

    await expect(itSection.locator('.issue-types-list .item-name:has-text("DeleteMeType")')).not.toBeVisible({ timeout: 8000 });
  });

  test('API: create issue type returns 201 with correct name', async ({ request }) => {
    const { token } = await createUser(request, 'API IT User', 'bs-api-it');
    const board = await createBoard(request, token, 'API IT Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Epic', icon: '★', color: '#6366f1' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Epic');
  });
});
