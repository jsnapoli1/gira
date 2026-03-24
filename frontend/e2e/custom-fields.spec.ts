import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function setupUserAndBoard(request: any) {
  const email = `test-cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'CF Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Custom Fields Test Board' },
    })
  ).json();

  return { token, board };
}

/** Create a custom field via API. Returns the created field object. */
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
  return res.json();
}

/**
 * Attempt to create a card. Returns null if the API returns a non-OK status
 * (e.g. Gitea 401). The caller should use test.skip() when null is returned.
 */
async function tryCreateCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title = 'Test Card',
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId },
  });
  if (!res.ok()) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Board Settings — Custom Fields Management
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings — Custom Fields (API + Settings UI)', () => {
  test('create text custom field via API and confirm it persists', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Project Code', 'text');
    expect(field.id).toBeTruthy();
    expect(field.name).toBe('Project Code');
    expect(field.field_type).toBe('text');

    // Confirm it appears in GET list
    const listRes = await request.get(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const fields = await listRes.json();
    expect(fields.some((f: any) => f.name === 'Project Code')).toBe(true);
  });

  test('create number custom field via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Story Points', 'number');
    expect(field.id).toBeTruthy();
    expect(field.field_type).toBe('number');
  });

  test('create select custom field with options via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const opts = JSON.stringify(['Low', 'Medium', 'High', 'Critical']);
    const field = await createField(request, token, board.id, 'Priority Level', 'select', opts);
    expect(field.id).toBeTruthy();
    expect(field.field_type).toBe('select');
  });

  test('create checkbox custom field via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Approved', 'checkbox');
    expect(field.id).toBeTruthy();
    expect(field.field_type).toBe('checkbox');
  });

  test('create date custom field via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Due On', 'date');
    expect(field.id).toBeTruthy();
    expect(field.field_type).toBe('date');
  });

  test('delete a custom field via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Temp Field', 'text');
    const fieldId = field.id;

    const delRes = await request.delete(`${BASE}/api/boards/${board.id}/custom-fields/${fieldId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok()).toBeTruthy();

    // Confirm deletion
    const listRes = await request.get(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const remaining = await listRes.json();
    expect(remaining.some((f: any) => f.id === fieldId)).toBe(false);
  });

  test('update (rename) a custom field via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Old Name', 'text');

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/custom-fields/${field.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { name: 'New Name', field_type: 'text', options: '', required: false },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('New Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card Modal — Custom Fields Rendering
// These tests navigate to the board UI and open a card modal.
// Card creation requires Gitea; tests skip gracefully when it fails.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Modal — Custom Fields Rendering', () => {
  test('no custom fields section shown when no fields exist', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // No custom fields defined — section should not be visible
    await expect(page.locator('.custom-fields-compact')).not.toBeVisible();
  });

  test('text custom field appears in card modal after creation', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Project Code', 'text');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.custom-field-inline label')).toContainText('Project Code');
    await expect(page.locator('.custom-field-inline input[type="text"]')).toBeVisible();
  });

  test('number custom field renders as number input in card modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Story Points', 'number');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.custom-field-inline input[type="number"]')).toBeVisible();
  });

  test('select custom field renders with correct options in card modal', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(
      request,
      token,
      board.id,
      'Priority Level',
      'select',
      JSON.stringify(['Low', 'Medium', 'High', 'Critical']),
    );

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    const select = page.locator('.custom-field-inline select');
    await expect(select).toBeVisible();

    const options = await select.locator('option').allTextContents();
    // At minimum the select should expose the defined option values
    const flatOptions = options.join(',');
    expect(flatOptions).toContain('High');
    expect(flatOptions).toContain('Medium');
  });

  test('checkbox custom field renders as checkbox in card modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Approved', 'checkbox');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    const checkbox = page.locator('.custom-field-inline input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card Modal — Custom Field Value Persistence
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Modal — Custom Field Value Persistence', () => {
  // Retry once to handle intermittent SQLite lock contention under parallelism
  test.describe.configure({ retries: 1 });

  test('text field value persists after close and reopen', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Client Name', 'text');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open card, fill value, blur to trigger save
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const input = page.locator('.custom-field-inline input[type="text"]');
    // Set up listener BEFORE fill so we can't miss the PUT response.
    const savePromise = page.waitForResponse(
      (r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT',
      { timeout: 10000 },
    ).catch(() => null);
    await input.fill('Acme Corporation');
    // Press Tab to trigger the React onBlur save handler reliably.
    await input.press('Tab');
    await savePromise;

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen and verify value
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(async () => {
      const fieldInput = page.locator('.custom-field-inline input[type="text"]');
      await expect(fieldInput).toBeVisible();
      await expect(fieldInput).toHaveValue('Acme Corporation');
    }).toPass({ timeout: 15000 });
  });

  test('select field value persists after close and reopen', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(
      request,
      token,
      board.id,
      'Priority Level',
      'select',
      JSON.stringify(['Low', 'Medium', 'High', 'Critical']),
    );

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const select = page.locator('.custom-field-inline select');
    // Wait for the save API response before closing to avoid races with SQLite
    const saveSelectPromise = page.waitForResponse((r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT', { timeout: 8000 }).catch(() => null);
    await select.selectOption('High');
    await saveSelectPromise;

    // Close and reopen
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(async () => {
      await expect(page.locator('.custom-field-inline select')).toHaveValue('High');
    }).toPass({ timeout: 10000 });
  });

  test('checkbox field value persists after close and reopen', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Approved', 'checkbox');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const checkbox = page.locator('.custom-field-inline input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
    // Wait for the save API response before closing to avoid races with SQLite
    const saveCheckboxPromise = page.waitForResponse((r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT', { timeout: 8000 }).catch(() => null);
    await checkbox.check();
    await saveCheckboxPromise;

    // Close and reopen
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(async () => {
      await expect(
        page.locator('.custom-field-inline input[type="checkbox"]'),
      ).toBeChecked();
    }).toPass({ timeout: 10000 });
  });

  test('custom field value persists across full page reload', async ({ page, request }) => {
    test.setTimeout(60000);
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Ticket Ref', 'text');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Set the value
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    const input = page.locator('.custom-field-inline input[type="text"]');
    // Set up the listener BEFORE fill to guarantee we don't miss the PUT response.
    const saveReloadPromise = page.waitForResponse(
      (r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT',
      { timeout: 10000 },
    ).catch(() => null);
    await input.fill('ZIRA-42');
    // Press Tab to blur the field and trigger the React onBlur save handler.
    await input.press('Tab');
    await saveReloadPromise;
    // Brief settle time to ensure the DB write has committed before reloading.
    await page.waitForTimeout(300);

    // Full page reload — token is re-injected via addInitScript on reload.
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
    await expect(async () => {
      await expect(page.locator('.custom-field-inline input[type="text"]')).toHaveValue('ZIRA-42');
    }).toPass({ timeout: 15000 });
  });
});
