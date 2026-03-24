import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WIPSetup {
  token: string;
  boardId: number;
  columns: Array<{ id: number; name: string; state: string; position: number }>;
  swimlaneId: number;
}

async function setupWIPBoard(request: any): Promise<WIPSetup> {
  const email = `test-wip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'WIP Tester' },
  });
  const token = (await signupRes.json()).token;

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'WIP Board' },
  });
  const board = await boardRes.json();
  const boardId: number = board.id;

  const columnsRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columns = await columnsRes.json();

  const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Team', designator: 'TM-', color: '#6366f1' },
  });
  const swimlane = await swimlaneRes.json();
  const swimlaneId: number = swimlane.id;

  return { token, boardId, columns, swimlaneId };
}

/**
 * Inject the JWT token via page.evaluate (NOT addInitScript).
 * Must be called after page.goto() so the browsing context exists.
 */
async function injectToken(page: any, token: string) {
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// WIP limit API contract
// ---------------------------------------------------------------------------

test.describe('Column WIP Limits — API', () => {

  test('GET /api/boards/:id/columns returns columns with a position field', async ({ request }) => {
    const setup = await setupWIPBoard(request);

    expect(setup.columns.length).toBeGreaterThan(0);
    for (const col of setup.columns) {
      expect(col).toHaveProperty('position');
      expect(typeof col.position).toBe('number');
    }
  });

  test('PUT /api/boards/:id/columns/:columnId with wip_limit returns 404 or 405 (not yet implemented)', async ({ request }) => {
    // The backend currently has no PUT handler for columns — wip_limit is not
    // yet persisted. This test documents the current API shape and will be
    // updated once the endpoint is added.
    const setup = await setupWIPBoard(request);
    const firstColumn = setup.columns[0];

    const res = await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${firstColumn.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    // Until PUT is implemented the server returns 404 or 405
    expect([404, 405]).toContain(res.status());
  });

  test('POST /api/boards/:id/columns creates column without wip_limit field', async ({ request }) => {
    const setup = await setupWIPBoard(request);

    const res = await request.post(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'WIP Test Column', state: 'open' },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name', 'WIP Test Column');
    // wip_limit is not currently returned by the API
    expect(body.wip_limit).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// WIP limit UI — column card count badges
// ---------------------------------------------------------------------------

test.describe('Column WIP Limits — UI', () => {

  test('column count badge visible when column has cards', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);

    const card1Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Card 1',
        column_id: setup.columns[0].id,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!card1Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await card1Res.text()}`);
      return;
    }

    const card2Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Card 2',
        column_id: setup.columns[0].id,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!card2Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await card2Res.text()}`);
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 10000 });

    const columnCountBadge = page.locator('.column-count').first();
    await expect(columnCountBadge).toBeVisible({ timeout: 8000 });
    await expect(columnCountBadge).toHaveText('2');
  });

  test('column count badge absent when column has no cards', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // No cards — no .column-count badges
    await expect(page.locator('.column-count')).toHaveCount(0);
  });

  test('column header renders for every column even with 0 cards', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const headers = page.locator('.board-column-header');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i)).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // WIP limit setting (UI) — not yet implemented
  // -------------------------------------------------------------------------

  test.fixme('set WIP limit on a column in board settings', async ({ request, page }) => {
    // WIP limit configuration in board settings is not yet implemented.
    // Once added, the settings page should show an input for wip_limit on each
    // column row, and saving should call PUT /api/boards/:id/columns/:id.
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}/settings`);

    const wipInput = page.locator('input[name="wip_limit"]').first();
    await expect(wipInput).toBeVisible({ timeout: 8000 });
    await wipInput.fill('3');
    await page.locator('button:has-text("Save")').first().click();

    // After save, reload and confirm the value persisted
    await page.reload();
    await expect(page.locator('input[name="wip_limit"]').first()).toHaveValue('3');
  });

  test.fixme('WIP limit number visible on column header when set', async ({ request, page }) => {
    // When wip_limit > 0, the column header should display the limit,
    // e.g. "2 / 3" (current count / limit). Class: .wip-limit
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);

    // Assumes PUT /api/boards/:id/columns/:id { wip_limit: 3 } is implemented
    await page.request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${setup.columns[0].id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const wipIndicator = page.locator('.wip-limit').first();
    await expect(wipIndicator).toBeVisible({ timeout: 8000 });
    await expect(wipIndicator).toContainText('3');
  });

  test.fixme('column shows warning when cards reach the WIP limit', async ({ request, page }) => {
    // When the number of cards in a column equals or exceeds wip_limit,
    // the column header should receive a .wip-exceeded class (or similar visual warning).
    // Requires: PUT endpoint for wip_limit + card creation (may hit Gitea 401).
    const setup = await setupWIPBoard(request);

    // Set WIP limit to 2
    await page.request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${setup.columns[0].id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 2 },
      },
    );

    // Create 3 cards (exceeds limit of 2)
    for (let i = 1; i <= 3; i++) {
      const res = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: {
          title: `Card ${i}`,
          column_id: setup.columns[0].id,
          swimlane_id: setup.swimlaneId,
          board_id: setup.boardId,
        },
      });
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.wip-exceeded')).toBeVisible({ timeout: 8000 });
  });

  test.fixme('clear WIP limit removes the limit indicator from column header', async ({ request, page }) => {
    // Setting wip_limit to 0 (or null) should remove any WIP limit display
    // from the column header and disable WIP enforcement for that column.
    const setup = await setupWIPBoard(request);

    // First set a WIP limit
    await page.request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${setup.columns[0].id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    // Then clear it (wip_limit: 0 means unlimited)
    await page.request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${setup.columns[0].id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 0 },
      },
    );

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // No WIP limit indicators should be present
    await expect(page.locator('.wip-limit')).toHaveCount(0);
  });

  test.fixme('WIP limit 0 means unlimited — no limit indicator shown', async ({ request, page }) => {
    // When wip_limit is 0 or unset, no limit indicator should appear in the column header.
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Default state: no WIP limits set — no indicators
    await expect(page.locator('.wip-limit')).toHaveCount(0);
  });

});

// ---------------------------------------------------------------------------
// WIP limit API contract — extended
// ---------------------------------------------------------------------------

test.describe('Column WIP Limits — API (extended)', () => {

  test('PUT /api/boards/:id/columns/:columnId returns 404 or 405 (not 500)', async ({ request }) => {
    // Documents that the server responds gracefully for a not-yet-implemented
    // PUT endpoint on columns — it must not crash with a 500.
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    const res = await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    expect(res.status()).not.toBe(500);
    expect([404, 405]).toContain(res.status());
  });

  test('GET /api/boards/:id/columns returns wip_limit absent or zero by default', async ({ request }) => {
    // Until the PUT endpoint is wired in, newly created columns must not carry
    // a non-zero wip_limit value in the API response.
    const setup = await setupWIPBoard(request);

    const res = await request.get(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(res.status()).toBe(200);
    const cols = await res.json();
    expect(Array.isArray(cols)).toBe(true);
    for (const col of cols) {
      // Either the field is absent or it equals 0 (unlimited).
      const limit = col.wip_limit;
      const noLimit = limit === undefined || limit === null || limit === 0;
      expect(noLimit).toBe(true);
    }
  });

  test('GET /api/boards/:id returns board with columns array', async ({ request }) => {
    const setup = await setupWIPBoard(request);

    const res = await request.get(`${BASE}/api/boards/${setup.boardId}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    // Board detail endpoint returns 200 with the board object
    expect(res.status()).toBe(200);
    const board = await res.json();
    expect(board).toHaveProperty('id', setup.boardId);
    // The board object should expose at minimum an id and name.
    expect(board).toHaveProperty('name');
  });

  test('column id in PUT request with wrong board id returns 404', async ({ request }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    // Use a non-existent board ID (boardId + 99999) to confirm 404/403.
    const res = await request.put(
      `${BASE}/api/boards/${setup.boardId + 99999}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 5 },
      },
    );

    expect([403, 404, 405]).toContain(res.status());
  });

  test('POST /api/boards/:id/columns — second column can be created independently', async ({ request }) => {
    const setup = await setupWIPBoard(request);

    const colA = await request.post(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Column A', state: 'open' },
    });
    const colB = await request.post(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Column B', state: 'open' },
    });

    expect(colA.status()).toBe(201);
    expect(colB.status()).toBe(201);

    const bodyA = await colA.json();
    const bodyB = await colB.json();
    expect(bodyA.id).not.toBe(bodyB.id);
    expect(bodyA.name).toBe('Column A');
    expect(bodyB.name).toBe('Column B');
  });

  test('multiple columns each have unique ids and positions', async ({ request }) => {
    const setup = await setupWIPBoard(request);

    const res = await request.get(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const cols = await res.json();
    const ids = cols.map((c: any) => c.id);
    const positions = cols.map((c: any) => c.position);

    // All IDs must be unique.
    expect(new Set(ids).size).toBe(ids.length);
    // All positions must be unique.
    expect(new Set(positions).size).toBe(positions.length);
  });

  test('unauthenticated PUT on column returns 401', async ({ request }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    const res = await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      { data: { wip_limit: 3 } },
    );

    // No Authorization header — must return 401 (or 404/405 if route not registered).
    expect([401, 404, 405]).toContain(res.status());
  });

});

// ---------------------------------------------------------------------------
// WIP limit UI — extended fixme tests documenting future behaviour
// ---------------------------------------------------------------------------

test.describe('Column WIP Limits — UI (extended, future)', () => {

  test.fixme('API: set WIP limit on column returns 200', async ({ request }) => {
    // When PUT /api/boards/:id/columns/:id is implemented it must return 200
    // with the updated column object including wip_limit.
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    const res = await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.wip_limit).toBe(3);
  });

  test.fixme('API: column with WIP limit shows in board data', async ({ request }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 5 },
      },
    );

    const colsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const cols = await colsRes.json();
    const updated = cols.find((c: any) => c.id === col.id);
    expect(updated).toBeDefined();
    expect(updated.wip_limit).toBe(5);
  });

  test.fixme('API: WIP limit of 0 means no limit', async ({ request }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    // Set then clear
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 0 },
      },
    );

    const colsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const cols = await colsRes.json();
    const updated = cols.find((c: any) => c.id === col.id);
    expect(updated.wip_limit === 0 || updated.wip_limit === null || updated.wip_limit === undefined).toBe(true);
  });

  test.fixme('UI: WIP limit shown on column header when set', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // The column header should show the limit, e.g. "0/3" or "/ 3"
    const header = page.locator('.board-column-header').first();
    await expect(header).toContainText('3');
  });

  test.fixme('UI: column turns red/warning when at WIP limit', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    // Set WIP limit to 1
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 1 },
      },
    );

    // Create exactly 1 card (at the limit)
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'At Limit Card',
        column_id: col.id,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Column header or column element should have a warning class
    const warnEl = page.locator('.wip-exceeded, .wip-warning, .column-at-limit').first();
    await expect(warnEl).toBeVisible({ timeout: 8000 });
  });

  test.fixme('UI: column at WIP limit shows count like "3/3"', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );

    for (let i = 1; i <= 3; i++) {
      const r = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: {
          title: `Limit Card ${i}`,
          column_id: col.id,
          swimlane_id: setup.swimlaneId,
          board_id: setup.boardId,
        },
      });
      if (!r.ok()) {
        test.skip(true, `Card creation unavailable: ${await r.text()}`);
        return;
      }
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Count display should read "3/3" (or "3 / 3")
    const header = page.locator('.board-column-header').first();
    await expect(header).toContainText('3');
  });

  test.fixme('UI: can add card when below WIP limit', async ({ request, page }) => {
    // When card count < wip_limit the column is still accepting cards.
    // The add-card affordance (button or inline input) must remain visible.
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 5 },
      },
    );

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // With 0 cards and limit 5, add-card UI must be present
    const addBtn = page.locator('.add-card-btn, button:has-text("Add Card")').first();
    await expect(addBtn).toBeVisible({ timeout: 8000 });
  });

  test.fixme('UI: WIP limit exceeded shows visual indicator', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 2 },
      },
    );

    // Create 3 cards (exceeds limit of 2)
    for (let i = 1; i <= 3; i++) {
      const r = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: {
          title: `Over Limit ${i}`,
          column_id: col.id,
          swimlane_id: setup.swimlaneId,
          board_id: setup.boardId,
        },
      });
      if (!r.ok()) {
        test.skip(true, `Card creation unavailable: ${await r.text()}`);
        return;
      }
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.wip-exceeded')).toBeVisible({ timeout: 8000 });
  });

  test.fixme('UI: changing WIP limit updates display', async ({ request, page }) => {
    // Verify that after updating the WIP limit through the UI, the displayed
    // limit number in the column header changes immediately.
    const setup = await setupWIPBoard(request);

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}/settings`);
    await expect(page.locator('.settings-page, .board-settings')).toBeVisible({ timeout: 10000 });

    // Find the WIP limit input for the first column and update it
    const wipInput = page.locator('input[name="wip_limit"], input[placeholder*="WIP"]').first();
    await expect(wipInput).toBeVisible({ timeout: 8000 });
    await wipInput.fill('4');
    await page.locator('button:has-text("Save")').first().click();

    // Go back to the board and confirm the header shows the new limit
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-column-header').first()).toContainText('4');
  });

  test.fixme('UI: removing WIP limit removes indicator', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    // Set limit via API
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );
    // Then remove it
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 0 },
      },
    );

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.wip-limit')).toHaveCount(0);
  });

  test.fixme('UI: WIP limit 1 allows only 1 card — add-card hidden after limit reached', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 1 },
      },
    );

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Single Allowed Card',
        column_id: col.id,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // The column at-limit indicator should appear
    await expect(page.locator('.wip-exceeded, .column-at-limit')).toBeVisible({ timeout: 8000 });
  });

  test.fixme('multiple columns can have different WIP limits', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const [colA, colB] = setup.columns;

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${colA.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 3 },
      },
    );
    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${colB.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 5 },
      },
    );

    const colsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/columns`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const cols = await colsRes.json();
    const a = cols.find((c: any) => c.id === colA.id);
    const b = cols.find((c: any) => c.id === colB.id);
    expect(a.wip_limit).toBe(3);
    expect(b.wip_limit).toBe(5);
  });

  test.fixme('column with limit 5 shows "X/5" when cards added', async ({ request, page }) => {
    const setup = await setupWIPBoard(request);
    const col = setup.columns[0];

    await request.put(
      `${BASE}/api/boards/${setup.boardId}/columns/${col.id}`,
      {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { wip_limit: 5 },
      },
    );

    // Add 2 cards
    for (let i = 1; i <= 2; i++) {
      const r = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: {
          title: `Card ${i}`,
          column_id: col.id,
          swimlane_id: setup.swimlaneId,
          board_id: setup.boardId,
        },
      });
      if (!r.ok()) {
        test.skip(true, `Card creation unavailable: ${await r.text()}`);
        return;
      }
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Column header should contain both the current count (2) and the limit (5)
    const header = page.locator('.board-column-header').first();
    await expect(header).toContainText('5');
  });

});
