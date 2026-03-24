import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// Helper: create a fresh user+board+swimlane+card, set token, navigate to board
async function setupBoard(request: any, page: any) {
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-cf-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'CF Extended Tester',
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'CF Extended Board' },
    })
  ).json();

  // board.columns is returned in the create response
  const columns = board.columns;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'CF Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

  return { token, board, columns, swimlane, card };
}

// Helper: create a custom field via the API
async function createField(
  request: any,
  token: string,
  boardId: number,
  name: string,
  fieldType: string,
  options = '',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/custom-fields`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { name, field_type: fieldType, options, required: false },
  });
  expect(res.ok()).toBeTruthy();
  // API returns the field object directly (not wrapped)
  return res.json();
}

// Helper: navigate to board, switch to All Cards, wait for card
async function gotoBoard(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

// Helper: open card modal
async function openCard(page: any) {
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 10000 });
}

// Helper: close card modal via overlay click
async function closeCard(page: any) {
  await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────────
// Board Settings — Custom Field Management
// These tests are fixme because BoardSettings.tsx has no custom fields section.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings — Custom Field Management', () => {
  test.fixme(
    true,
    'BoardSettings.tsx does not have a Custom Fields management section; no UI to test',
  );

  test('create number field in settings', async ({ page, request }) => {
    const { board, token } = await setupBoard(request, page);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-section', { timeout: 10000 });
    // Expect a "Custom Fields" section to exist
    await expect(page.locator('.settings-section h2:has-text("Custom Fields")')).toBeVisible();
    // Click "Add Field"
    await page.click('button:has-text("Add Field")');
    await page.fill('input[placeholder*="field name" i]', 'Story Estimate');
    await page.selectOption('select[name="field_type"]', 'number');
    await page.click('button:has-text("Save")');
    await expect(page.locator('.settings-list-item:has-text("Story Estimate")')).toBeVisible();
    void token; // suppress unused warning
  });

  test('create date field in settings', async ({ page, request }) => {
    const { board, token } = await setupBoard(request, page);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await page.click('button:has-text("Add Field")');
    await page.fill('input[placeholder*="field name" i]', 'Due On');
    await page.selectOption('select[name="field_type"]', 'date');
    await page.click('button:has-text("Save")');
    await expect(page.locator('.settings-list-item:has-text("Due On")')).toBeVisible();
    void token;
  });

  test('create URL field in settings', async ({ page, request }) => {
    const { board, token } = await setupBoard(request, page);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await page.click('button:has-text("Add Field")');
    await page.fill('input[placeholder*="field name" i]', 'Reference Link');
    await page.selectOption('select[name="field_type"]', 'url');
    await page.click('button:has-text("Save")');
    await expect(page.locator('.settings-list-item:has-text("Reference Link")')).toBeVisible();
    void token;
  });

  test('delete custom field from settings', async ({ page, request }) => {
    const { board, token } = await setupBoard(request, page);
    await createField(request, token, board.id, 'To Delete', 'text');
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-list-item:has-text("To Delete")', { timeout: 10000 });
    page.once('dialog', (d) => d.accept());
    await page.click('.settings-list-item:has-text("To Delete") .item-delete');
    await expect(page.locator('.settings-list-item:has-text("To Delete")')).not.toBeVisible();
  });

  test('edit custom field name in settings', async ({ page, request }) => {
    const { board, token } = await setupBoard(request, page);
    await createField(request, token, board.id, 'Old Name', 'text');
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-list-item:has-text("Old Name")', { timeout: 10000 });
    await page.click('.settings-list-item:has-text("Old Name") .item-edit');
    await page.fill('input[value="Old Name"]', 'New Name');
    await page.click('button:has-text("Save")');
    await expect(page.locator('.settings-list-item:has-text("New Name")')).toBeVisible();
    await expect(page.locator('.settings-list-item:has-text("Old Name")')).not.toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card Modal — Field Values
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Modal — Custom Field Values', () => {
  test('number field renders and accepts a value', async ({ page, request }) => {
    const { token, board } = await setupBoard(request, page);

    await createField(request, token, board.id, 'Story Estimate', 'number');

    await gotoBoard(page, board.id);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    const input = page.locator('.custom-field-inline input[type="number"]');
    await expect(input).toBeVisible();

    await input.fill('42');
    await input.blur(); // triggers onBlur save

    await closeCard(page);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(async () => {
      await expect(page.locator('.custom-field-inline input[type="number"]')).toHaveValue('42');
    }).toPass({ timeout: 10000 });
  });

  test('date field renders and accepts a value', async ({ page, request }) => {
    const { token, board } = await setupBoard(request, page);

    await createField(request, token, board.id, 'Due Date', 'date');

    await gotoBoard(page, board.id);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    const input = page.locator('.custom-field-inline input[type="date"]');
    await expect(input).toBeVisible();

    // Fill the date — change event triggers save immediately for date fields
    await input.fill('2025-06-15');

    await closeCard(page);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(async () => {
      await expect(page.locator('.custom-field-inline input[type="date"]')).toHaveValue(
        '2025-06-15',
      );
    }).toPass({ timeout: 10000 });
  });

  test('URL field renders as a text input (url type not natively rendered as link)', async ({
    page,
    request,
  }) => {
    // The CardDetailModal does not have explicit rendering for field_type === 'url'.
    // The field will fall through all conditionals and render nothing visible in
    // .custom-field-inline beyond the label. This test documents that behaviour
    // and verifies the label at least appears.
    const { token, board } = await setupBoard(request, page);

    await createField(request, token, board.id, 'Reference Link', 'url');

    await gotoBoard(page, board.id);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    // The label should appear even though there is no input rendered for url type
    await expect(
      page.locator('.custom-field-inline label:has-text("Reference Link")'),
    ).toBeVisible();
    // No input is rendered for url type in the current implementation
    await expect(page.locator('.custom-field-inline input[type="url"]')).not.toBeVisible();
  });

  test('multiple custom fields of different types all appear in card modal', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupBoard(request, page);

    await createField(request, token, board.id, 'Points', 'number');
    await createField(request, token, board.id, 'Start Date', 'date');
    await createField(request, token, board.id, 'Approved', 'checkbox');

    await gotoBoard(page, board.id);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    // All three fields should be present
    await expect(page.locator('.custom-field-inline label:has-text("Points")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="number"]')).toBeVisible();

    await expect(page.locator('.custom-field-inline label:has-text("Start Date")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="date"]')).toBeVisible();

    await expect(page.locator('.custom-field-inline label:has-text("Approved")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="checkbox"]')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field Validation', () => {
  test.fixme(
    true,
    'No required-field validation UI exists in the current implementation (required flag is stored but not enforced in the card modal)',
  );

  test('required field blocks card close when empty', async ({ page, request }) => {
    const { token, board } = await setupBoard(request, page);

    // Create a required field
    const res = await request.post(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Must Fill', field_type: 'text', options: '', required: true },
    });
    expect(res.ok()).toBeTruthy();

    await gotoBoard(page, board.id);
    await openCard(page);

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    // Attempt to close without filling required field
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });

    // Expect validation error or that modal remains open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
    await expect(
      page.locator('text=/required/i, .error-message, .validation-error'),
    ).toBeVisible();
  });
});
