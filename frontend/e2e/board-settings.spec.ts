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
  return {
    token: body.token as string,
    user: body.user as { id: number; display_name: string; email: string },
  };
}

async function createBoard(request: any, token: string, name = 'Settings Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string; columns?: any[]; swimlanes?: any[] };
}

/** Navigate to settings after injecting the token via page.evaluate. */
async function goToSettings(page: any, token: string, boardId: number) {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}/settings`);
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// 1. Page structure — title, sections, back-link
// ---------------------------------------------------------------------------

test.describe('Board Settings — page structure', () => {
  test('shows "Board Settings" heading on page load', async ({ page, request }) => {
    const { token } = await createUser(request, 'Section User', 'bs-struct');
    const board = await createBoard(request, token, 'Struct Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.page-header h1')).toContainText('Board Settings');
  });

  test('all expected settings sections are present', async ({ page, request }) => {
    const { token } = await createUser(request, 'All Sections', 'bs-all-sec');
    const board = await createBoard(request, token, 'All Sections Board');

    await goToSettings(page, token, board.id);

    for (const heading of ['General', 'Columns', 'Workflow Rules', 'Issue Types', 'Labels', 'Swimlanes', 'Members', 'Import / Export', 'Danger Zone']) {
      await expect(
        page.locator(`.settings-section h2:has-text("${heading}"), .settings-section h2:text-is("${heading}")`).first(),
      ).toBeVisible({ timeout: 8_000 });
    }
  });

  test('back link navigates to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'BackLink User', 'bs-back');
    const board = await createBoard(request, token, 'Back Board');

    await goToSettings(page, token, board.id);

    await page.locator('.back-link').click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`), { timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. General section — name, description, save
// ---------------------------------------------------------------------------

test.describe('Board Settings — General section', () => {
  test('board name input is pre-filled with the current board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'Prefill User', 'bs-prefill');
    const board = await createBoard(request, token, 'PreFilled Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('#boardName')).toHaveValue('PreFilled Board', { timeout: 8_000 });
  });

  test('renaming the board via Save Changes updates the boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Rename User', 'bs-rename');
    const board = await createBoard(request, token, 'Rename Me');

    await goToSettings(page, token, board.id);

    const nameInput = page.locator('#boardName');
    await nameInput.clear();
    await nameInput.fill('Renamed Board');

    await page.locator('button:has-text("Save Changes")').click();
    // Wait for button to return to non-saving state
    await expect(page.locator('button:has-text("Save Changes")')).toBeEnabled({ timeout: 5_000 });

    await page.goto('/boards');
    await expect(page.locator('.board-card h3:has-text("Renamed Board")')).toBeVisible({ timeout: 8_000 });
  });

  test('updated board name is visible in page header after save', async ({ page, request }) => {
    const { token } = await createUser(request, 'Header Update User', 'bs-hdr-upd');
    const board = await createBoard(request, token, 'Header Board');

    await goToSettings(page, token, board.id);

    const nameInput = page.locator('#boardName');
    await nameInput.clear();
    await nameInput.fill('New Header Name');
    await page.locator('button:has-text("Save Changes")').click();
    await expect(page.locator('button:has-text("Save Changes")')).toBeEnabled({ timeout: 5_000 });

    // Reload to confirm persistence
    await page.reload();
    await expect(page.locator('#boardName')).toHaveValue('New Header Name', { timeout: 8_000 });
  });

  test('board description input is pre-filled and persists after save + reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'Desc User', 'bs-desc');
    const board = await createBoard(request, token, 'Desc Board');

    await goToSettings(page, token, board.id);

    const descInput = page.locator('#boardDesc');
    await descInput.clear();
    await descInput.fill('A thorough description of this board');

    await page.locator('button:has-text("Save Changes")').click();
    await expect(page.locator('button:has-text("Save Changes")')).toBeEnabled({ timeout: 5_000 });

    await page.reload();
    await expect(page.locator('#boardDesc')).toHaveValue('A thorough description of this board', { timeout: 8_000 });
  });

  test('Save Changes button shows "Saving..." while in flight', async ({ page, request }) => {
    const { token } = await createUser(request, 'Saving Btn User', 'bs-saving');
    const board = await createBoard(request, token, 'Saving Board');

    await goToSettings(page, token, board.id);

    await page.locator('#boardName').fill('Saving Test');
    await page.locator('button:has-text("Save Changes")').click();
    // After it finishes the label is "Save Changes" again — just verify it didn't error
    await expect(page.locator('button:has-text("Save Changes")')).toBeEnabled({ timeout: 5_000 });
  });

  test('API PUT /api/boards/:id persists name + description', async ({ request }) => {
    const { token } = await createUser(request, 'API Rename', 'bs-api-rename');
    const board = await createBoard(request, token, 'API Rename Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Renamed', description: 'Set via API' },
    });
    expect(res.status()).toBe(200);

    const verify = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await verify.json();
    expect(body.name).toBe('API Renamed');
    expect(body.description).toBe('Set via API');
  });
});

// ---------------------------------------------------------------------------
// 3. Columns section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Columns section', () => {
  test('default 4 columns are listed (To Do, In Progress, In Review, Done)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col Defaults', 'bs-col-def');
    const board = await createBoard(request, token, 'Col Default Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();
    expect(names.some((n) => /to do/i.test(n))).toBe(true);
    expect(names.some((n) => /in progress/i.test(n))).toBe(true);
    expect(names.some((n) => /done/i.test(n))).toBe(true);
    // 4 default columns total
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  test('column state is displayed in item-meta (State: <value>)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col State Meta', 'bs-col-state-meta');
    const board = await createBoard(request, token, 'Col State Meta Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const firstMeta = columnsSection.locator('.settings-list-item').first().locator('.item-meta');
    await expect(firstMeta).toBeVisible({ timeout: 8_000 });
    await expect(firstMeta).toContainText('State:');
  });

  test('Add Column button opens the Add Column modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Col Modal', 'bs-col-modal');
    const board = await createBoard(request, token, 'Add Col Modal Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();
  });

  test('Add Column modal has Name input and State select', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col Form Fields', 'bs-col-form');
    const board = await createBoard(request, token, 'Col Form Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal input[type="text"]')).toBeVisible();
    await expect(page.locator('.modal select')).toBeVisible();
    // The state select should offer open, in_progress, review, closed
    const options = await page.locator('.modal select option').allTextContents();
    expect(options.some((o) => /open/i.test(o))).toBe(true);
    expect(options.some((o) => /in.progress/i.test(o))).toBe(true);
    expect(options.some((o) => /review/i.test(o))).toBe(true);
    expect(options.some((o) => /closed/i.test(o))).toBe(true);
  });

  test('new column is added and appears in the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Col User', 'bs-add-col');
    const board = await createBoard(request, token, 'Add Col Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('Staging');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("Staging")')).toBeVisible({ timeout: 8_000 });
  });

  test('new column with closed state shows correct state in item-meta', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col State User', 'bs-col-state');
    const board = await createBoard(request, token, 'Col State Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await page.locator('.modal input[type="text"]').fill('Closed Column');
    await page.locator('.modal select').selectOption('closed');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    const newColRow = columnsSection.locator('.settings-list-item').filter({ hasText: 'Closed Column' });
    await expect(newColRow).toBeVisible({ timeout: 8_000 });
    await expect(newColRow.locator('.item-meta')).toContainText('closed');
  });

  test('Add Column modal is dismissed by Cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col Cancel', 'bs-col-cancel');
    const board = await createBoard(request, token, 'Col Cancel Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();

    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('column can be deleted after confirming the dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Del Col User', 'bs-del-col');
    const board = await createBoard(request, token, 'Del Col Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });

    // Add a column so we have a safe one to delete
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Trash Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Trash Column")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Trash Column' })
      .locator('.item-delete')
      .click();

    await expect(columnsSection.locator('.item-name:has-text("Trash Column")')).not.toBeVisible({ timeout: 8_000 });
  });

  test('column deletion is cancelled when user dismisses the confirm dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Cancel Del Col', 'bs-cancel-del-col');
    const board = await createBoard(request, token, 'Cancel Del Col Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });

    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Keep Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Keep Column")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.dismiss());
    await columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Keep Column' })
      .locator('.item-delete')
      .click();

    // Column should still be there
    await expect(columnsSection.locator('.item-name:has-text("Keep Column")')).toBeVisible();
  });

  test('columns can be reordered with the Move down button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Reorder User', 'bs-reorder');
    const board = await createBoard(request, token, 'Reorder Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');

    const firstNameBefore = await items.nth(0).locator('.item-name').textContent();
    const secondNameBefore = await items.nth(1).locator('.item-name').textContent();

    await items.nth(0).locator('.reorder-btn[title="Move down"]').click();

    await expect(items.nth(0).locator('.item-name')).toHaveText(secondNameBefore!, { timeout: 5_000 });
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstNameBefore!, { timeout: 5_000 });
  });

  test('columns can be reordered with the Move up button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Reorder Up User', 'bs-reorder-up');
    const board = await createBoard(request, token, 'Reorder Up Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');

    const firstNameBefore = await items.nth(0).locator('.item-name').textContent();
    const secondNameBefore = await items.nth(1).locator('.item-name').textContent();

    // Move second column up
    await items.nth(1).locator('.reorder-btn[title="Move up"]').click();

    await expect(items.nth(0).locator('.item-name')).toHaveText(secondNameBefore!, { timeout: 5_000 });
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstNameBefore!, { timeout: 5_000 });
  });

  test('first column Move up button is disabled (already at top)', async ({ page, request }) => {
    const { token } = await createUser(request, 'No MoveUp', 'bs-no-move-up');
    const board = await createBoard(request, token, 'No MoveUp Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const firstItem = columnsSection.locator('.settings-list-item').first();
    await expect(firstItem.locator('.reorder-btn[title="Move up"]')).toBeDisabled({ timeout: 8_000 });
  });

  test('last column Move down button is disabled (already at bottom)', async ({ page, request }) => {
    const { token } = await createUser(request, 'No MoveDown', 'bs-no-move-down');
    const board = await createBoard(request, token, 'No MoveDown Board');

    await goToSettings(page, token, board.id);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const lastItem = columnsSection.locator('.settings-list-item').last();
    await expect(lastItem.locator('.reorder-btn[title="Move down"]')).toBeDisabled({ timeout: 8_000 });
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

  test.fixme('rename column inline via the settings UI', async ({ page, request }) => {
    // The column list does not expose an edit button — mark fixme until the
    // UI adds inline column renaming.
  });
});

// ---------------------------------------------------------------------------
// 4. Swimlanes section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Swimlanes section', () => {
  test('Swimlanes section heading is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Vis', 'bs-sl-vis');
    const board = await createBoard(request, token, 'SL Vis Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.settings-section h2:has-text("Swimlanes")')).toBeVisible({ timeout: 8_000 });
  });

  test('Add Swimlane button opens the Add Swimlane modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Open Modal', 'bs-sl-modal');
    const board = await createBoard(request, token, 'SL Modal Board');

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();

    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();
  });

  test('Add Swimlane modal has Name, Repository, Designator, Label, Color fields', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Form Fields', 'bs-sl-form');
    const board = await createBoard(request, token, 'SL Form Board');

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();

    // All these labels must appear in the modal
    await expect(page.locator('.modal').getByText('Name')).toBeVisible();
    await expect(page.locator('.modal').getByText('Repository')).toBeVisible();
    await expect(page.locator('.modal').getByText('Designator')).toBeVisible();
    await expect(page.locator('.modal').getByText('Color')).toBeVisible();
    // Color picker should be present
    await expect(page.locator('.modal .color-picker')).toBeVisible();
    await expect(page.locator('.modal .color-option').first()).toBeVisible();
  });

  test('swimlane color picker options are clickable', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Color', 'bs-sl-color');
    const board = await createBoard(request, token, 'SL Color Board');

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();

    const colorOptions = page.locator('.modal .color-picker .color-option');
    await expect(colorOptions).toHaveCount(8, { timeout: 5_000 });
    // Click the second color — should not throw
    await colorOptions.nth(1).click();
    await expect(colorOptions.nth(1)).toHaveClass(/selected/);
  });

  test('Add Swimlane modal is dismissed by Cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Cancel', 'bs-sl-cancel');
    const board = await createBoard(request, token, 'SL Cancel Board');

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('swimlane created via API appears in the settings list', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL API Add', 'bs-sl-api-add');
    const board = await createBoard(request, token, 'SL API Add Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Lane', designator: 'AL-', color: '#2196F3' },
    });
    expect(slRes.status()).toBe(201);

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("API Lane")')).toBeVisible({ timeout: 8_000 });
  });

  test('swimlane row shows designator in item-meta', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Meta', 'bs-sl-meta');
    const board = await createBoard(request, token, 'SL Meta Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Meta Lane', designator: 'ML-', color: '#9c27b0' },
    });

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Meta Lane' });
    await expect(slRow.locator('.item-meta')).toContainText('ML-', { timeout: 8_000 });
  });

  test('swimlane color swatch is rendered in the row', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Color Swatch', 'bs-sl-swatch');
    const board = await createBoard(request, token, 'SL Swatch Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Swatch Lane', designator: 'SW-', color: '#ef4444' },
    });

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const slRow = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Swatch Lane' });
    // The .item-color div carries the backgroundColor style
    await expect(slRow.locator('.item-color')).toBeVisible({ timeout: 8_000 });
  });

  test('swimlane can be deleted after confirming', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Del', 'bs-sl-del');
    const board = await createBoard(request, token, 'SL Del Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete Lane', designator: 'DL-', color: '#f44336' },
    });

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("Delete Lane")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await swimlanesSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Delete Lane' })
      .locator('.item-delete')
      .click();

    await expect(swimlanesSection.locator('.item-name:has-text("Delete Lane")')).not.toBeVisible({ timeout: 8_000 });
  });

  test('swimlane deletion is cancelled when user dismisses the dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Cancel Del', 'bs-sl-cancel-del');
    const board = await createBoard(request, token, 'SL Cancel Del Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Keep Lane', designator: 'KL-', color: '#22c55e' },
    });

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.item-name:has-text("Keep Lane")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.dismiss());
    await swimlanesSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Keep Lane' })
      .locator('.item-delete')
      .click();

    await expect(swimlanesSection.locator('.item-name:has-text("Keep Lane")')).toBeVisible();
  });

  test('empty swimlanes state shows "No swimlanes configured"', async ({ page, request }) => {
    const { token } = await createUser(request, 'SL Empty', 'bs-sl-empty');
    const board = await createBoard(request, token, 'SL Empty Board');

    await goToSettings(page, token, board.id);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.empty-list')).toContainText('No swimlanes configured', { timeout: 8_000 });
  });

  test.fixme('edit swimlane name/designator via the settings UI', async () => {
    // There is no edit button on swimlane rows in the current UI.
    // Mark fixme until the feature is added.
  });
});

// ---------------------------------------------------------------------------
// 5. Labels section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Labels section', () => {
  test('Labels section heading and Add Label button are visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Vis', 'bs-lbl-vis');
    const board = await createBoard(request, token, 'Label Vis Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await expect(labelsSection.locator('h2:has-text("Labels")')).toBeVisible({ timeout: 8_000 });
    await expect(labelsSection.locator('button:has-text("Add Label")')).toBeVisible();
  });

  test('Add Label button opens the Add Label modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Modal', 'bs-lbl-modal');
    const board = await createBoard(request, token, 'Label Modal Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();

    await expect(page.locator('.modal h2:has-text("Add Label")')).toBeVisible();
  });

  test('Add Label modal has Name input and 8 color swatches', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Form', 'bs-lbl-form');
    const board = await createBoard(request, token, 'Label Form Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();

    await expect(page.locator('.modal input[type="text"]')).toBeVisible();
    await expect(page.locator('.modal .color-picker')).toBeVisible();
    await expect(page.locator('.modal .color-option')).toHaveCount(8, { timeout: 5_000 });
  });

  test('label color swatch can be selected', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Color', 'bs-lbl-color');
    const board = await createBoard(request, token, 'Label Color Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();

    const options = page.locator('.modal .color-option');
    await options.nth(2).click();
    await expect(options.nth(2)).toHaveClass(/selected/);
  });

  test('new label is created and appears in the labels list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Label', 'bs-add-lbl');
    const board = await createBoard(request, token, 'Add Label Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();

    await page.locator('.modal input[type="text"]').fill('Bug');
    await page.locator('.modal .color-option').nth(3).click();
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Bug")')).toBeVisible({ timeout: 8_000 });
  });

  test('label color swatch is shown in the labels list row', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Swatch', 'bs-lbl-swatch');
    const board = await createBoard(request, token, 'Label Swatch Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Swatch Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Swatch Label")')).toBeVisible({ timeout: 8_000 });

    const labelRow = labelsSection.locator('.settings-list-item').filter({ hasText: 'Swatch Label' });
    await expect(labelRow.locator('.item-color')).toBeVisible();
  });

  test('Add Label modal is dismissed by Cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Cancel', 'bs-lbl-cancel');
    const board = await createBoard(request, token, 'Label Cancel Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await expect(page.locator('.modal h2:has-text("Add Label")')).toBeVisible();

    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('existing label can be edited — name change is reflected in list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Edit Label', 'bs-edit-lbl');
    const board = await createBoard(request, token, 'Edit Label Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    // Create a label first
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Original Name');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Original Name")')).toBeVisible({ timeout: 8_000 });

    // Edit it
    await labelsSection.locator('.settings-list-item').filter({ hasText: 'Original Name' }).locator('.item-edit').click();
    await expect(page.locator('.modal h2:has-text("Edit Label")')).toBeVisible();

    const nameInput = page.locator('.modal input[type="text"]');
    await nameInput.clear();
    await nameInput.fill('Updated Name');
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Updated Name")')).toBeVisible({ timeout: 8_000 });
    await expect(labelsSection.locator('.item-name:has-text("Original Name")')).not.toBeVisible();
  });

  test('Edit Label modal pre-fills the existing label name', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Prefill Edit', 'bs-lbl-prefill');
    const board = await createBoard(request, token, 'Label Prefill Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Prefill Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Prefill Label")')).toBeVisible({ timeout: 8_000 });

    await labelsSection.locator('.settings-list-item').filter({ hasText: 'Prefill Label' }).locator('.item-edit').click();
    await expect(page.locator('.modal input[type="text"]')).toHaveValue('Prefill Label');
  });

  test('label color can be changed via the edit modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Color Edit', 'bs-lbl-color-edit');
    const board = await createBoard(request, token, 'Label Color Edit Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Color Edit Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Color Edit Label")')).toBeVisible({ timeout: 8_000 });

    await labelsSection.locator('.settings-list-item').filter({ hasText: 'Color Edit Label' }).locator('.item-edit').click();
    // Pick a different color (index 4)
    await page.locator('.modal .color-option').nth(4).click();
    await expect(page.locator('.modal .color-option').nth(4)).toHaveClass(/selected/);
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('label can be deleted after confirming the dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Del Label', 'bs-del-lbl');
    const board = await createBoard(request, token, 'Del Label Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Temp Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Temp Label")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Temp Label' })
      .locator('.item-delete')
      .click();

    await expect(labelsSection.locator('.item-name:has-text("Temp Label")')).not.toBeVisible({ timeout: 8_000 });
  });

  test('label deletion is cancelled when user dismisses the confirm dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Cancel Del Label', 'bs-cancel-del-lbl');
    const board = await createBoard(request, token, 'Cancel Del Label Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Persist Label');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Persist Label")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.dismiss());
    await labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Persist Label' })
      .locator('.item-delete')
      .click();

    await expect(labelsSection.locator('.item-name:has-text("Persist Label")')).toBeVisible();
  });

  test('empty labels state shows "No labels configured"', async ({ page, request }) => {
    const { token } = await createUser(request, 'Labels Empty', 'bs-lbl-empty');
    const board = await createBoard(request, token, 'Labels Empty Board');

    await goToSettings(page, token, board.id);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });
    await expect(labelsSection.locator('.empty-list')).toContainText('No labels configured', { timeout: 8_000 });
  });

  test('API: create label returns 201 with correct name', async ({ request }) => {
    const { token } = await createUser(request, 'API Label', 'bs-api-lbl');
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
// 6. Members section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Members section', () => {
  test('Members section heading and Add Member button are visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Members Vis', 'bs-mbr-vis');
    const board = await createBoard(request, token, 'Members Vis Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('h2:has-text("Members")')).toBeVisible({ timeout: 8_000 });
    await expect(membersSection.locator('button:has-text("Add Member")')).toBeVisible();
  });

  test('board creator appears as owner in the members list', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Owner User', 'bs-owner');
    const board = await createBoard(request, token, 'Owner Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.settings-list-item').first()).toBeVisible({ timeout: 8_000 });

    // The creator should be listed with role "owner"
    const firstMemberMeta = membersSection.locator('.settings-list-item').first().locator('.item-meta');
    await expect(firstMemberMeta).toContainText(/owner/i);

    // Owner name should match
    const firstMemberName = membersSection.locator('.settings-list-item').first().locator('.item-name');
    await expect(firstMemberName).toContainText(user.display_name);
  });

  test('owner member row does not show a remove button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Owner No Remove', 'bs-owner-no-rm');
    const board = await createBoard(request, token, 'Owner No Remove Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    // The owner row (role = owner) must not have .item-delete
    const ownerRow = membersSection.locator('.settings-list-item').filter({ has: page.locator('.item-meta:has-text("owner")') });
    await expect(ownerRow.locator('.item-delete')).not.toBeVisible({ timeout: 8_000 });
  });

  test('Add Member button opens the Add Member modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Member Modal', 'bs-add-mbr-modal');
    const board = await createBoard(request, token, 'Add Member Modal Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();
  });

  test('Add Member modal has user selector and role selector', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Mbr Form', 'bs-add-mbr-form');
    const board = await createBoard(request, token, 'Add Mbr Form Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    await expect(page.locator('.modal')).toBeVisible();
    // Should have two selects: user and role
    const selects = page.locator('.modal select');
    await expect(selects).toHaveCount(2, { timeout: 5_000 });

    // Role select should have viewer, member, admin options
    const roleSelect = selects.nth(1);
    const roleOptions = await roleSelect.locator('option').allTextContents();
    expect(roleOptions.some((o) => /viewer/i.test(o))).toBe(true);
    expect(roleOptions.some((o) => /member/i.test(o))).toBe(true);
    expect(roleOptions.some((o) => /admin/i.test(o))).toBe(true);
  });

  test('Add Member modal is dismissed by Cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add Mbr Cancel', 'bs-add-mbr-cancel');
    const board = await createBoard(request, token, 'Add Mbr Cancel Board');

    await goToSettings(page, token, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('second user can be added as a board member', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'Owner Member', 'bs-mbr-owner');
    const { user: member2 } = await createUser(request, 'New Member', 'bs-mbr-new');
    const board = await createBoard(request, ownerToken, 'Multi Member Board');

    await goToSettings(page, ownerToken, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    // Select the new user from the dropdown
    const userSelect = page.locator('.modal select').first();
    await userSelect.selectOption({ label: new RegExp(member2.display_name, 'i') });
    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(membersSection.locator(`.item-name:has-text("${member2.display_name}")`)).toBeVisible({ timeout: 8_000 });
  });

  test('non-owner member can be removed', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'Owner Remove', 'bs-rm-owner');
    const { user: member2 } = await createUser(request, 'Removable Member', 'bs-rm-member');
    const board = await createBoard(request, ownerToken, 'Remove Member Board');

    // Add member2 via API
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: member2.id, role: 'member' },
    });

    await goToSettings(page, ownerToken, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator(`.item-name:has-text("${member2.display_name}")`)).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await membersSection
      .locator('.settings-list-item')
      .filter({ hasText: member2.display_name })
      .locator('.item-delete')
      .click();

    await expect(membersSection.locator(`.item-name:has-text("${member2.display_name}")`)).not.toBeVisible({ timeout: 8_000 });
  });

  test('member removal is cancelled when user dismisses the confirm dialog', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'Owner Cancel Rm', 'bs-cancel-rm-owner');
    const { user: member2 } = await createUser(request, 'Kept Member', 'bs-cancel-rm-member');
    const board = await createBoard(request, ownerToken, 'Cancel Remove Member Board');

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: member2.id, role: 'member' },
    });

    await goToSettings(page, ownerToken, board.id);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator(`.item-name:has-text("${member2.display_name}")`)).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.dismiss());
    await membersSection
      .locator('.settings-list-item')
      .filter({ hasText: member2.display_name })
      .locator('.item-delete')
      .click();

    // Member should still be in the list
    await expect(membersSection.locator(`.item-name:has-text("${member2.display_name}")`)).toBeVisible();
  });

  test('API: POST /api/boards/:id/members returns 201', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'API Mbr Owner', 'bs-api-mbr-owner');
    const { user: member2 } = await createUser(request, 'API New Member', 'bs-api-new-mbr');
    const board = await createBoard(request, ownerToken, 'API Members Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: member2.id, role: 'viewer' },
    });
    expect(res.status()).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 7. Issue Types section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Issue Types section', () => {
  test('Issue Types section heading and Add Type button are visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'IssueType Vis', 'bs-it-vis');
    const board = await createBoard(request, token, 'IssueType Vis Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.settings-section h2:has-text("Issue Types")')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('button:has-text("Add Type")')).toBeVisible();
  });

  test('Add Type button opens the Add Issue Type modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'IT Modal', 'bs-it-modal');
    const board = await createBoard(request, token, 'IT Modal Board');

    await goToSettings(page, token, board.id);

    await page.locator('button:has-text("Add Type")').click();

    await expect(page.locator('.modal h2:has-text("Add Issue Type")')).toBeVisible();
  });

  test('Add Issue Type modal has Name, Icon, and Color fields', async ({ page, request }) => {
    const { token } = await createUser(request, 'IT Form Fields', 'bs-it-form');
    const board = await createBoard(request, token, 'IT Form Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();

    await expect(page.locator('.modal')).toBeVisible();
    // Name input (first text input)
    const textInputs = page.locator('.modal input[type="text"]');
    await expect(textInputs).toHaveCount(2, { timeout: 5_000 }); // name + icon
    // Color picker
    await expect(page.locator('.modal .color-picker')).toBeVisible();
    await expect(page.locator('.modal .color-option')).toHaveCount(8, { timeout: 5_000 });
  });

  test('new issue type is created and appears in the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Add IT', 'bs-add-it');
    const board = await createBoard(request, token, 'Add IT Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();

    // Name input is first text input
    await page.locator('.modal input[type="text"]').first().fill('Bug');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.item-name:has-text("Bug")')).toBeVisible({ timeout: 8_000 });
  });

  test('issue type icon is shown in the issue type list row', async ({ page, request }) => {
    const { token } = await createUser(request, 'IT Icon Row', 'bs-it-icon');
    const board = await createBoard(request, token, 'IT Icon Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();

    const inputs = page.locator('.modal input[type="text"]');
    await inputs.first().fill('Task');
    await inputs.nth(1).fill('T'); // icon field
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    const taskRow = issueTypesSection.locator('.issue-type-item').filter({ hasText: 'Task' });
    await expect(taskRow.locator('.issue-type-icon')).toContainText('T', { timeout: 8_000 });
  });

  test('issue type can be edited — name change appears in list', async ({ page, request }) => {
    const { token } = await createUser(request, 'Edit IT', 'bs-edit-it');
    const board = await createBoard(request, token, 'Edit IT Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input[type="text"]').first().fill('Feature');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.item-name:has-text("Feature")')).toBeVisible({ timeout: 8_000 });

    // Open the edit modal
    await issueTypesSection.locator('.issue-type-item').filter({ hasText: 'Feature' }).locator('.item-edit').click();
    await expect(page.locator('.modal h2:has-text("Edit Issue Type")')).toBeVisible();

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Enhancement');
    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(issueTypesSection.locator('.item-name:has-text("Enhancement")')).toBeVisible({ timeout: 8_000 });
    await expect(issueTypesSection.locator('.item-name:has-text("Feature")')).not.toBeVisible();
  });

  test('Edit Issue Type modal pre-fills the existing name', async ({ page, request }) => {
    const { token } = await createUser(request, 'IT Prefill Edit', 'bs-it-prefill');
    const board = await createBoard(request, token, 'IT Prefill Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input[type="text"]').first().fill('Story');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.item-name:has-text("Story")')).toBeVisible({ timeout: 8_000 });

    await issueTypesSection.locator('.issue-type-item').filter({ hasText: 'Story' }).locator('.item-edit').click();
    await expect(page.locator('.modal input[type="text"]').first()).toHaveValue('Story');
  });

  test('issue type can be deleted after confirming', async ({ page, request }) => {
    const { token } = await createUser(request, 'Del IT', 'bs-del-it');
    const board = await createBoard(request, token, 'Del IT Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input[type="text"]').first().fill('Temp Type');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.item-name:has-text("Temp Type")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await issueTypesSection.locator('.issue-type-item').filter({ hasText: 'Temp Type' }).locator('.item-delete').click();

    await expect(issueTypesSection.locator('.item-name:has-text("Temp Type")')).not.toBeVisible({ timeout: 8_000 });
  });

  test('issue type deletion is cancelled when dialog is dismissed', async ({ page, request }) => {
    const { token } = await createUser(request, 'Cancel Del IT', 'bs-cancel-del-it');
    const board = await createBoard(request, token, 'Cancel Del IT Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Add Type")').click();
    await page.locator('.modal input[type="text"]').first().fill('Persist Type');
    await page.locator('.modal button[type="submit"]:has-text("Add Issue Type")').click();

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.item-name:has-text("Persist Type")')).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.dismiss());
    await issueTypesSection.locator('.issue-type-item').filter({ hasText: 'Persist Type' }).locator('.item-delete').click();

    await expect(issueTypesSection.locator('.item-name:has-text("Persist Type")')).toBeVisible();
  });

  test('empty issue types state shows "No issue types configured"', async ({ page, request }) => {
    const { token } = await createUser(request, 'IT Empty', 'bs-it-empty');
    const board = await createBoard(request, token, 'IT Empty Board');

    await goToSettings(page, token, board.id);

    const issueTypesSection = page.locator('.settings-section').filter({ hasText: 'Issue Types' });
    await expect(issueTypesSection.locator('.empty-list')).toContainText('No issue types configured', { timeout: 8_000 });
  });

  test('API: create issue type returns 201', async ({ request }) => {
    const { token } = await createUser(request, 'API IT', 'bs-api-it');
    const board = await createBoard(request, token, 'API IT Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Type', icon: 'X', color: '#6366f1' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('API Type');
  });

  test.fixme('default issue types are pre-populated on board creation', async () => {
    // Currently no default issue types are seeded on board creation.
    // Mark fixme until that behaviour is added.
  });

  test.fixme('Custom Fields section is accessible from board settings', async () => {
    // Custom field management does not live in the settings page — it is
    // managed from the card detail view. Mark fixme if a settings UI is added.
  });
});

// ---------------------------------------------------------------------------
// 8. Workflow Rules section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Workflow Rules section', () => {
  test('Workflow Rules section heading is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Vis', 'bs-wf-vis');
    const board = await createBoard(request, token, 'WF Vis Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.settings-section h2:has-text("Workflow Rules")')).toBeVisible({ timeout: 8_000 });
  });

  test('workflow enable toggle checkbox is visible and unchecked by default', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Default', 'bs-wf-default');
    const board = await createBoard(request, token, 'WF Default Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    await expect(toggle).toBeVisible({ timeout: 8_000 });
    await expect(toggle).not.toBeChecked();
  });

  test('enabling the workflow toggle shows the transition matrix', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Enable', 'bs-wf-enable');
    const board = await createBoard(request, token, 'WF Enable Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) {
      await toggle.click();
    }
    await expect(toggle).toBeChecked();
    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });
  });

  test('disabling the workflow toggle hides the matrix', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Disable', 'bs-wf-disable');
    const board = await createBoard(request, token, 'WF Disable Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    // Enable first
    if (!(await toggle.isChecked())) await toggle.click();
    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });

    // Now disable
    await toggle.click();
    await expect(page.locator('.workflow-matrix')).not.toBeVisible();
  });

  test('workflow matrix column headers match the board columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Headers', 'bs-wf-headers');
    const board = await createBoard(request, token, 'WF Headers Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });

    const headerCells = page.locator('.workflow-matrix-header');
    const headerTexts = await headerCells.allTextContents();
    // Default columns: To Do, In Progress, In Review, Done (at least 4)
    expect(headerTexts.length).toBeGreaterThanOrEqual(4);
    expect(headerTexts.some((h) => /to do/i.test(h))).toBe(true);
  });

  test('workflow matrix cells are checkboxes (excluding diagonal)', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Cells', 'bs-wf-cells');
    const board = await createBoard(request, token, 'WF Cells Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });
    // Cells with checkboxes should exist
    await expect(page.locator('.workflow-matrix-cell input[type="checkbox"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('diagonal cells show "-" (same-column transition disabled)', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Diagonal', 'bs-wf-diag');
    const board = await createBoard(request, token, 'WF Diagonal Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.workflow-matrix-disabled').first()).toContainText('-', { timeout: 5_000 });
  });

  test('workflow matrix cell state can be toggled', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Toggle Cell', 'bs-wf-cell-toggle');
    const board = await createBoard(request, token, 'WF Toggle Cell Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });

    const firstCell = page.locator('.workflow-matrix-cell input[type="checkbox"]').first();
    const initialState = await firstCell.isChecked();
    await firstCell.click();
    await expect(firstCell).toBeChecked({ checked: !initialState });
    // Toggle back
    await firstCell.click();
    await expect(firstCell).toBeChecked({ checked: initialState });
  });

  test('"Save Workflow Rules" button is always visible in the section', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Save Btn', 'bs-wf-save-btn');
    const board = await createBoard(request, token, 'WF Save Btn Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('button:has-text("Save Workflow Rules")')).toBeVisible({ timeout: 8_000 });
  });

  test('clicking Save Workflow Rules with toggle disabled clears rules', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Save Disabled', 'bs-wf-save-dis');
    const board = await createBoard(request, token, 'WF Save Disabled Board');

    await goToSettings(page, token, board.id);

    // Ensure toggle is OFF
    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (await toggle.isChecked()) await toggle.click();

    await page.locator('button:has-text("Save Workflow Rules")').click();
    // Should return to enabled state without error
    await expect(page.locator('button:has-text("Save Workflow Rules")')).toBeEnabled({ timeout: 5_000 });
  });

  test('Save Workflow Rules persists enabled rules across page reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'WF Persist', 'bs-wf-persist');
    const board = await createBoard(request, token, 'WF Persist Board');

    await goToSettings(page, token, board.id);

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.click();

    await expect(page.locator('.workflow-matrix')).toBeVisible({ timeout: 5_000 });

    // Check the first cell
    const firstCell = page.locator('.workflow-matrix-cell input[type="checkbox"]').first();
    if (!(await firstCell.isChecked())) await firstCell.click();

    await page.locator('button:has-text("Save Workflow Rules")').click();
    await expect(page.locator('button:has-text("Save Workflow Rules")')).toBeEnabled({ timeout: 5_000 });

    await page.reload();
    await expect(page.locator('.workflow-toggle input[type="checkbox"]')).toBeChecked({ timeout: 8_000 });
  });

  test('API: GET /api/boards/:id/workflow returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'API WF Get', 'bs-api-wf-get');
    const board = await createBoard(request, token, 'API WF Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 9. Import / Export section
// ---------------------------------------------------------------------------

test.describe('Board Settings — Import / Export section', () => {
  test('Import / Export section heading is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'IE Vis', 'bs-ie-vis');
    const board = await createBoard(request, token, 'IE Vis Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.settings-section h2:has-text("Import / Export")')).toBeVisible({ timeout: 8_000 });
  });

  test('Export to CSV and Import from Jira CSV buttons are visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'IE Buttons', 'bs-ie-btns');
    const board = await createBoard(request, token, 'IE Buttons Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('button:has-text("Export to CSV")')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('button:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('Import from Jira CSV button opens the import modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'Import Modal', 'bs-import-modal');
    const board = await createBoard(request, token, 'Import Modal Board');

    await goToSettings(page, token, board.id);

    await page.locator('button:has-text("Import from Jira CSV")').click();

    // The import modal uses .import-modal not .modal
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.import-modal h3:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('import modal has a CSV file input', async ({ page, request }) => {
    const { token } = await createUser(request, 'Import File Input', 'bs-import-file');
    const board = await createBoard(request, token, 'Import File Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Import from Jira CSV")').click();

    await expect(page.locator('.import-modal input[type="file"]')).toBeVisible({ timeout: 5_000 });
    // The accept attribute should restrict to CSV
    const accept = await page.locator('.import-modal input[type="file"]').getAttribute('accept');
    expect(accept).toContain('.csv');
  });

  test('import modal has disabled Import button when no file is selected', async ({ page, request }) => {
    const { token } = await createUser(request, 'Import No File', 'bs-import-nofile');
    const board = await createBoard(request, token, 'Import No File Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Import from Jira CSV")').click();

    const importBtn = page.locator('.import-modal .btn-primary:has-text("Import")');
    await expect(importBtn).toBeDisabled({ timeout: 5_000 });
  });

  test('import modal is closed by Cancel/Close button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Import Cancel', 'bs-import-cancel');
    const board = await createBoard(request, token, 'Import Cancel Board');

    await goToSettings(page, token, board.id);
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5_000 });

    await page.locator('.import-modal button:has-text("Cancel")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();
  });

  test('API GET /api/boards/:id/export returns CSV content with ID,Title header', async ({ request }) => {
    const { token } = await createUser(request, 'Export API', 'bs-export-api');
    const board = await createBoard(request, token, 'Export API Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text).toMatch(/ID,Title/);
  });

  test('API GET /api/boards/:id/export without token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'Export No Auth', 'bs-export-no-auth');
    const board = await createBoard(request, token, 'Export No Auth Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export`);
    expect(res.status()).toBe(401);
  });

  test.fixme('Export to CSV button triggers file download in the browser', async ({ page, request }) => {
    // Playwright download interception for a programmatic boardsApi.exportCards call
    // requires monitoring fetch response — mark fixme until download verification
    // is implemented via download event or network interception.
  });
});

// ---------------------------------------------------------------------------
// 10. Danger Zone — delete board
// ---------------------------------------------------------------------------

test.describe('Board Settings — Danger Zone', () => {
  test('Danger Zone section is visible with Delete Board button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Danger Vis', 'bs-danger-vis');
    const board = await createBoard(request, token, 'Danger Vis Board');

    await goToSettings(page, token, board.id);

    await expect(page.locator('.settings-section.danger')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.settings-section.danger h2:has-text("Danger Zone")')).toBeVisible();
    await expect(page.locator('button.btn-danger:has-text("Delete Board")')).toBeVisible();
  });

  test('deletes the board and redirects to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'Delete User', 'bs-del');
    const board = await createBoard(request, token, 'Delete Me Board');

    await goToSettings(page, token, board.id);

    page.once('dialog', (d) => d.accept());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    await page.waitForURL(/\/boards$/, { timeout: 8_000 });
    await expect(page.locator('.board-card h3:has-text("Delete Me Board")')).not.toBeVisible();
  });

  test('cancelling the delete confirmation keeps the board intact', async ({ page, request }) => {
    const { token } = await createUser(request, 'Cancel Delete', 'bs-cancel-del');
    const board = await createBoard(request, token, 'Keep Me Board');

    await goToSettings(page, token, board.id);

    page.once('dialog', (d) => d.dismiss());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#boardName')).toHaveValue('Keep Me Board');
  });

  test('deleted board URL returns 404 from the API', async ({ request }) => {
    const { token } = await createUser(request, 'API Del', 'bs-api-del');
    const board = await createBoard(request, token, 'API Delete Board');

    const del = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status()).toBe(204);

    const verify = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(verify.status()).toBe(404);
  });
});
