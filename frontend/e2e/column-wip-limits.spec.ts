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
