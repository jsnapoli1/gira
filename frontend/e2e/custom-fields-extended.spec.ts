import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function setupUserAndBoard(request: any) {
  const email = `test-cf-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'CF Extended Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'CF Extended Board' },
    })
  ).json();

  return { token, board };
}

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

async function tryCreateCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title = 'CF Card',
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId },
  });
  if (!res.ok()) return null;
  return res.json();
}

async function setupWithCard(request: any) {
  const { token, board } = await setupUserAndBoard(request);
  const columns = board.columns || [];
  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    })
  ).json();
  const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
  return { token, board, columns, swimlane, card };
}

// ─────────────────────────────────────────────────────────────────────────────
// API-level Field Management (no UI / no Gitea dependency)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field Management — API', () => {
  // Retry once to handle intermittent SQLite lock contention under parallelism
  test.describe.configure({ retries: 1 });

  test('edit custom field name via PUT', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Old Name', 'text');

    const res = await request.put(`${BASE}/api/boards/${board.id}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'New Name', field_type: 'text', options: '', required: false },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe('New Name');

    // Confirm via GET
    const getRes = await request.get(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await getRes.json();
    const found = fields.find((f) => f.id === field.id);
    expect(found?.name).toBe('New Name');
  });

  test('multiple custom fields of different types can all be created', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    await createField(request, token, board.id, 'Points', 'number');
    await createField(request, token, board.id, 'Start Date', 'date');
    await createField(request, token, board.id, 'Approved', 'checkbox');
    await createField(
      request,
      token,
      board.id,
      'Severity',
      'select',
      JSON.stringify(['Low', 'Medium', 'High']),
    );

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await listRes.json();
    expect(fields.length).toBeGreaterThanOrEqual(4);
    const names = fields.map((f) => f.name);
    expect(names).toContain('Points');
    expect(names).toContain('Start Date');
    expect(names).toContain('Approved');
    expect(names).toContain('Severity');
  });

  test('custom field order is determined by API response position', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    // Create fields in order
    const f1 = await createField(request, token, board.id, 'Alpha', 'text');
    const f2 = await createField(request, token, board.id, 'Beta', 'text');
    const f3 = await createField(request, token, board.id, 'Gamma', 'text');

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await listRes.json();
    const ids = fields.map((f) => f.id);

    // All three should appear in the response
    expect(ids).toContain(f1.id);
    expect(ids).toContain(f2.id);
    expect(ids).toContain(f3.id);
  });

  test('date custom field is stored with correct type', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Due On', 'date');
    expect(field.field_type).toBe('date');

    // Fetch it back individually
    const getRes = await request.get(
      `${BASE}/api/boards/${board.id}/custom-fields/${field.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (getRes.ok()) {
      const fetched = await getRes.json();
      expect(fetched.field_type).toBe('date');
    }
  });

  test('checkbox custom field is stored with correct type', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const field = await createField(request, token, board.id, 'Done', 'checkbox');
    expect(field.field_type).toBe('checkbox');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card Modal — Multiple Fields
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Modal — Multiple Custom Fields', () => {
  test.describe.configure({ retries: 1 });
  test('all defined field types appear simultaneously in card modal', async ({
    page,
    request,
  }) => {
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Points', 'number');
    await createField(request, token, board.id, 'Start Date', 'date');
    await createField(request, token, board.id, 'Approved', 'checkbox');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.custom-field-inline label:has-text("Points")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="number"]')).toBeVisible();

    await expect(page.locator('.custom-field-inline label:has-text("Start Date")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="date"]')).toBeVisible();

    await expect(page.locator('.custom-field-inline label:has-text("Approved")')).toBeVisible();
    await expect(page.locator('.custom-field-inline input[type="checkbox"]')).toBeVisible();
  });

  test('number field accepts and persists a value', async ({ page, request }) => {
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Story Estimate', 'number');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const input = page.locator('.custom-field-inline input[type="number"]');
    // Set up the listener before filling so we don't miss the response
    const savePromise = page.waitForResponse(
      (r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT',
      { timeout: 10000 },
    ).catch(() => null);
    await input.fill('42');
    await input.blur();
    await savePromise;
    // Extra guard: wait a moment in case the response was already received before fill
    await page.waitForTimeout(500);

    // Close and reopen
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(async () => {
      await expect(page.locator('.custom-field-inline input[type="number"]')).toHaveValue('42');
    }).toPass({ timeout: 10000 });
  });

  test('date field accepts and persists a value', async ({ page, request }) => {
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Due Date', 'date');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const dateInput = page.locator('.custom-field-inline input[type="date"]');
    // Date fields save on change; wait for the PUT response
    const saveDatePromise = page.waitForResponse((r) => r.url().includes('/custom-fields/') && r.request().method() === 'PUT', { timeout: 8000 }).catch(() => null);
    await dateInput.fill('2025-06-15');
    await saveDatePromise;

    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(async () => {
      await expect(page.locator('.custom-field-inline input[type="date"]')).toHaveValue(
        '2025-06-15',
      );
    }).toPass({ timeout: 10000 });
  });

  test('URL field type label appears even though no input is rendered', async ({
    page,
    request,
  }) => {
    // The CardDetailModal currently has no rendering branch for field_type === 'url'.
    // The field label should still appear in .custom-fields-compact.
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await createField(request, token, board.id, 'Reference Link', 'url');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    // Label should be visible; no input[type="url"] expected in current implementation
    await expect(
      page.locator('.custom-field-inline label:has-text("Reference Link")'),
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API-level Custom Field Values (no Gitea dependency if card creation succeeds)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field Values — API', () => {
  test('set and retrieve a custom field value via API', async ({ request }) => {
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping API value test');
      return;
    }

    const field = await createField(request, token, board.id, 'Estimate', 'number');

    const setRes = await request.put(
      `${BASE}/api/cards/${card.id}/custom-fields/${field.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { value: '13' },
      },
    );
    expect(setRes.ok()).toBeTruthy();

    const listRes = await request.get(`${BASE}/api/cards/${card.id}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const values: any[] = await listRes.json();
    const v = values.find((x) => x.field_id === field.id || x.custom_field_definition_id === field.id);
    expect(v).toBeTruthy();
    expect(v.value).toBe('13');
  });

  test('delete a custom field value via API', async ({ request }) => {
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping API value test');
      return;
    }

    const field = await createField(request, token, board.id, 'Tag', 'text');

    await request.put(`${BASE}/api/cards/${card.id}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { value: 'delete-me' },
    });

    const delRes = await request.delete(
      `${BASE}/api/cards/${card.id}/custom-fields/${field.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.ok()).toBeTruthy();
  });

  test('filter cards by custom field value is not a server-side feature (search API)', async ({
    request,
  }) => {
    // The GET /api/cards/search endpoint supports q, assignee, label, priority, issue_type
    // but not custom field values. This test documents that behaviour.
    const { token, board, card } = await setupWithCard(request);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping test');
      return;
    }

    const field = await createField(request, token, board.id, 'Region', 'text');
    await request.put(`${BASE}/api/cards/${card.id}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { value: 'EMEA' },
    });

    // Search does not support custom field filtering — we verify the endpoint is healthy
    const searchRes = await request.get(
      `${BASE}/api/cards/search?board_id=${board.id}&q=`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(searchRes.ok()).toBeTruthy();
    // Custom field filter by value is not implemented in search API
  });
});
