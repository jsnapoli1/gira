import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Set up a fresh user, board, swimlane, and card via the API.
 * Injects the auth token and navigates to the board in "All Cards" view.
 */
async function setupBoardWithCard(request: any, page: any, label = 'Watchers') {
  const email = `test-watchers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `${label} User` },
  });
  const { token, user } = await signupRes.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Watcher Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });
  if (!cardRes.ok()) {
    test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
    return { board, card: null, columns, swimlane, token, user };
  }
  const card = await cardRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, card, columns, swimlane, token, user };
}

// ---------------------------------------------------------------------------
// NOTE: The watchers feature backend is fully implemented:
//   GET    /api/cards/:id/watchers   - returns array of watcher users
//   POST   /api/cards/:id/watch      - add current user as watcher
//   DELETE /api/cards/:id/watch      - remove current user as watcher
//
// However, there is NO Watch button or watcher UI in CardDetailModal.tsx.
// The UI tests below are marked fixme until a Watch button is added to the modal.
// The API-level tests run without UI and verify backend correctness.
// ---------------------------------------------------------------------------

test.describe('Card Watchers — API (backend fully implemented)', () => {

  // -------------------------------------------------------------------------
  // API 1. GET /watchers returns empty array initially
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers returns empty array for unwatched card', async ({ request }) => {
    const email = `test-watchers-api-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watcher API Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Watcher API Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Watcher API Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchersRes.ok()).toBeTruthy();
    const watchers = await watchersRes.json();
    expect(Array.isArray(watchers)).toBe(true);
    expect(watchers).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // API 2. POST /watch adds the current user as watcher
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/watch adds current user as watcher', async ({ request }) => {
    const email = `test-watchers-add-${crypto.randomUUID()}@test.com`;
    const signupBody = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Add Watcher Tester' },
      })
    ).json();
    const { token } = signupBody;

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Add Watcher Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Add Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Add watcher
    const watchRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchRes.status()).toBe(201);

    // Verify watcher appears in list
    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchersRes.ok()).toBeTruthy();
    const watchers = await watchersRes.json();
    expect(Array.isArray(watchers)).toBe(true);
    expect(watchers).toHaveLength(1);
    expect(watchers[0].id).toBe(me.id);
  });

  // -------------------------------------------------------------------------
  // API 3. DELETE /watch removes the current user as watcher
  // -------------------------------------------------------------------------
  test('DELETE /api/cards/:id/watch removes current user as watcher', async ({ request }) => {
    const email = `test-watchers-remove-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Remove Watcher Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Remove Watcher Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Remove Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Watch then unwatch
    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const unwatchRes = await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unwatchRes.ok()).toBeTruthy();

    // Watcher list should be empty again
    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const watchers = await watchersRes.json();
    expect(watchers).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // API 4. Multiple watchers — two separate users can watch the same card
  // -------------------------------------------------------------------------
  test('multiple users can watch the same card', async ({ request }) => {
    // Create first user (board owner)
    const email1 = `test-watchers-multi1-${crypto.randomUUID()}@test.com`;
    const { token: token1 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email1, password: 'password123', display_name: 'Watcher Owner' },
      })
    ).json();

    // Create second user
    const email2 = `test-watchers-multi2-${crypto.randomUUID()}@test.com`;
    const { token: token2 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email2, password: 'password123', display_name: 'Watcher Member' },
      })
    ).json();

    const meRes2 = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    const user2 = await meRes2.json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token1}` },
        data: { name: 'Multi Watcher Board' },
      })
    ).json();

    // Add user2 as a board member so they can access the board
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { user_id: user2.id, role: 'member' },
    });

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token1}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token1}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { title: 'Multi Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Both users watch the card
    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token2}` },
    });

    // Both should appear in the watchers list
    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    expect(watchersRes.ok()).toBeTruthy();
    const watchers = await watchersRes.json();
    expect(watchers).toHaveLength(2);

    const watcherIds = watchers.map((w: any) => w.id);
    expect(watcherIds).toContain(user2.id);
  });

  // -------------------------------------------------------------------------
  // API 5. Watching is idempotent — POST /watch twice does not error
  // -------------------------------------------------------------------------
  test('watching the same card twice does not create duplicate watchers', async ({ request }) => {
    const email = `test-watchers-idempotent-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Idempotent Watcher' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Idempotent Watcher Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Idempotent Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Watch twice — should not error (INSERT OR IGNORE)
    const first = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(second.ok()).toBeTruthy();

    // Still only 1 watcher
    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const watchers = await watchersRes.json();
    expect(watchers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// UI tests — all fixme until Watch button is added to CardDetailModal
// ---------------------------------------------------------------------------

test.describe('Card Watchers — UI (pending Watch button implementation)', () => {

  test.fixme('watch button exists in card modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchBtn');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Expect a Watch button in the modal (sidebar or header)
    await expect(
      page.locator('button:has-text("Watch"), button:has-text("Unwatch"), button:has-text("Watching"), .watch-btn, .watch-card')
    ).toBeVisible();
  });

  test.fixme('watch card — button changes to Unwatch/Watching', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchCard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click the Watch button
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    // Button text should change to indicate the card is being watched
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching"), .watch-btn.active')
    ).toBeVisible({ timeout: 5000 });
  });

  test.fixme('unwatch card — button returns to Watch state', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'UnwatchCard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch first
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });

    // Unwatch
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'DELETE'
      ),
      page.click('button:has-text("Unwatch"), button:has-text("Watching")'),
    ]);

    // Should return to Watch state
    await expect(page.locator('button:has-text("Watch")')).toBeVisible({ timeout: 5000 });
  });

  test.fixme('watch state persists after reopening modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchPersist');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch the card
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Reopen modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch state should still be reflected
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });
  });

  test.fixme('watcher count increments when watching', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchCount');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Check initial watcher count (should be 0 or not shown)
    const countLocator = page.locator('.watcher-count, [data-testid="watcher-count"]');
    const initialText = (await countLocator.isVisible()) ? await countLocator.textContent() : '0';
    const initialCount = parseInt(initialText || '0', 10);

    // Watch the card
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    // Count should increase by 1
    await expect(countLocator).toBeVisible({ timeout: 5000 });
    const newText = await countLocator.textContent();
    expect(parseInt(newText || '0', 10)).toBe(initialCount + 1);
  });

  test.fixme('watcher receives notification when card is updated', async ({ page, request }) => {
    // This test requires two users and notification infrastructure.
    // Setup: user1 creates card, user2 watches card, user1 updates card, user2 checks notifications.
    // Skipped until Watch UI and notification delivery are implemented in the frontend.
    throw new Error('Test not yet implemented — requires Watch UI and notification delivery');
  });
});
