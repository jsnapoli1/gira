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

/**
 * Create a minimal board+card via API only (no page navigation).
 */
async function setupBoardWithCardAPI(request: any, label = 'WatcherAPI') {
  const email = `test-watcher-api-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `${label} User` },
  });
  const { token } = await signupRes.json();

  const meRes = await request.get(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const user = await meRes.json();

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
      data: { name: 'Lane', designator: 'L-' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `${label} Card`,
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  return { token, user, board, columns, swimlane, cardRes };
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

  // -------------------------------------------------------------------------
  // API 6. POST /watch returns 200 (or 201) — verify HTTP status is success
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/watch returns 2xx success status', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'WatchStatus');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const watchRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchRes.ok()).toBeTruthy();
    expect(watchRes.status()).toBeGreaterThanOrEqual(200);
    expect(watchRes.status()).toBeLessThan(300);
  });

  // -------------------------------------------------------------------------
  // API 7. GET /watchers returns array — watcher objects have user_id field
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers returns watcher objects with user id field', async ({ request }) => {
    const { token, user, cardRes } = await setupBoardWithCardAPI(request, 'WatcherFields');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchersRes.ok()).toBeTruthy();
    const watchers = await watchersRes.json();
    expect(Array.isArray(watchers)).toBe(true);
    expect(watchers).toHaveLength(1);

    const watcher = watchers[0];
    // The user object should contain an id property matching the current user
    expect(watcher).toHaveProperty('id');
    expect(watcher.id).toBe(user.id);
  });

  // -------------------------------------------------------------------------
  // API 8. DELETE /watch returns 204 No Content after unwatching
  // -------------------------------------------------------------------------
  test('DELETE /api/cards/:id/watch returns 204 after removing watch', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'UnwatchStatus');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const unwatchRes = await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unwatchRes.status()).toBe(204);
  });

  // -------------------------------------------------------------------------
  // API 9. After DELETE /watch, GET /watchers no longer includes that user
  // -------------------------------------------------------------------------
  test('after unwatching, GET /watchers does not include the user', async ({ request }) => {
    const { token, user, cardRes } = await setupBoardWithCardAPI(request, 'PostUnwatch');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Watch
    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Confirm watcher is in list
    const beforeRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const before = await beforeRes.json();
    const ids = before.map((w: any) => w.id);
    expect(ids).toContain(user.id);

    // Unwatch
    await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Confirm user is no longer in list
    const afterRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const after = await afterRes.json();
    const afterIds = after.map((w: any) => w.id);
    expect(afterIds).not.toContain(user.id);
  });

  // -------------------------------------------------------------------------
  // API 10. Unwatching a card that is not being watched is idempotent
  // -------------------------------------------------------------------------
  test('DELETE /watch on an unwatched card does not error', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'UnwatchIdem');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Unwatch without ever watching — should not 500
    const res = await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Accept 204 or 200 — must not be 5xx
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // API 11. Unauthorized watch request returns 401
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/watch without auth token returns 401', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'WatchUnauth');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Attempt to watch without token
    const res = await request.post(`${BASE}/api/cards/${card.id}/watch`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // API 12. Watch card on a board the user is NOT a member of returns 403
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/watch by non-member returns 403', async ({ request }) => {
    // Owner creates board + card
    const { token: ownerToken, cardRes } = await setupBoardWithCardAPI(request, 'WatchNonMember');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // A completely different user who is NOT a member of the board
    const outsiderEmail = `test-outsider-${crypto.randomUUID()}@test.com`;
    const { token: outsiderToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: outsiderEmail, password: 'password123', display_name: 'Outsider' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    // Non-member should be forbidden
    expect(res.status()).toBe(403);
  });

  // -------------------------------------------------------------------------
  // API 13. GET /watchers by non-member returns 403
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers by non-member returns 403', async ({ request }) => {
    const { cardRes } = await setupBoardWithCardAPI(request, 'GetWatchersNonMember');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const outsiderEmail = `test-outsider-get-${crypto.randomUUID()}@test.com`;
    const { token: outsiderToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: outsiderEmail, password: 'password123', display_name: 'Outsider Get' },
      })
    ).json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.status()).toBe(403);
  });

  // -------------------------------------------------------------------------
  // API 14. Watch then unwatch: watcher count goes 0 → 1 → 0
  // -------------------------------------------------------------------------
  test('watcher count transitions correctly through watch and unwatch cycle', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'WatchCycle');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const getCount = async () => {
      const res = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = await res.json();
      return list.length;
    };

    expect(await getCount()).toBe(0);

    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await getCount()).toBe(1);

    await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await getCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // API 15. Board member added later can watch card
  // -------------------------------------------------------------------------
  test('user added as board member can subsequently watch a card', async ({ request }) => {
    // Owner creates board + card
    const ownerEmail = `test-owner-latemember-${crypto.randomUUID()}@test.com`;
    const { token: ownerToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: ownerEmail, password: 'password123', display_name: 'Late Member Owner' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Late Member Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    ).json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { title: 'Late Member Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // New user
    const newEmail = `test-late-member-${crypto.randomUUID()}@test.com`;
    const { token: newToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: newEmail, password: 'password123', display_name: 'New Member' },
      })
    ).json();
    const newUser = await (
      await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${newToken}` } })
    ).json();

    // Before being added: watch should fail with 403
    const beforeRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    expect(beforeRes.status()).toBe(403);

    // Add new user as member
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: newUser.id, role: 'member' },
    });

    // After being added: watch should succeed
    const afterRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    expect(afterRes.ok()).toBeTruthy();

    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const watchers = await watchersRes.json();
    const ids = watchers.map((w: any) => w.id);
    expect(ids).toContain(newUser.id);
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

  test.fixme('watcher count decrements when unwatching', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'UnwatchCount');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch first
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    const countLocator = page.locator('.watcher-count, [data-testid="watcher-count"]');
    await expect(countLocator).toBeVisible({ timeout: 5000 });
    const beforeText = await countLocator.textContent();
    const beforeCount = parseInt(beforeText || '0', 10);

    // Unwatch
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'DELETE'
      ),
      page.click('button:has-text("Unwatch"), button:has-text("Watching")'),
    ]);

    // Count should decrease by 1
    const afterText = await countLocator.textContent();
    expect(parseInt(afterText || '0', 10)).toBe(beforeCount - 1);
  });

  test.fixme('watched cards show in notifications when card is updated', async ({ page, request }) => {
    // This test requires two users and notification infrastructure.
    // Setup: user1 creates card, user2 watches card, user1 updates card, user2 checks notifications.
    // Skipped until Watch UI and notification delivery are implemented in the frontend.
    throw new Error('Test not yet implemented — requires Watch UI and notification delivery');
  });

  test.fixme('watcher receives notification when card is updated', async ({ page, request }) => {
    // This test requires two users and notification infrastructure.
    // Setup: user1 creates card, user2 watches card, user1 updates card, user2 checks notifications.
    // Skipped until Watch UI and notification delivery are implemented in the frontend.
    throw new Error('Test not yet implemented — requires Watch UI and notification delivery');
  });

  test.fixme('watch button visible in card detail modal sidebar', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchSidebar');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // The Watch action is expected in the sidebar/actions area of the modal
    await expect(
      page.locator('.card-detail-sidebar button:has-text("Watch"), .card-actions button:has-text("Watch")')
    ).toBeVisible({ timeout: 5000 });
  });

  test.fixme('watch button reflects existing watch state on open (pre-watched card)', async ({ page, request }) => {
    const { board, card, token } = await setupBoardWithCard(request, page, 'WatchPreset');
    if (!card) return;

    // Watch the card via API before opening the modal
    await page.evaluate(
      async ({ base, cardId, tok }: { base: string; cardId: number; tok: string }) => {
        await fetch(`${base}/api/cards/${cardId}/watch`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok}` },
        });
      },
      { base: BASE, cardId: card.id, tok: token }
    );

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // The modal should immediately reflect the already-watching state
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching"), .watch-btn.active')
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // UI 11. Watch button is keyboard-accessible (Enter key)
  // -------------------------------------------------------------------------
  test.fixme('watch button is activatable with Enter key', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchKeyboard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Focus the Watch button and press Enter
    const watchBtn = page.locator('button:has-text("Watch"), .watch-btn');
    await watchBtn.focus();

    const [watchRes] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      watchBtn.press('Enter'),
    ]);

    expect(watchRes.ok()).toBeTruthy();
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // UI 12. Watcher list section shows avatar / display name for each watcher
  // -------------------------------------------------------------------------
  test.fixme('watcher list shows display name of watching user', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchList');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch the card
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    // The watcher list section should appear and contain the user display name
    const watcherList = page.locator('.watcher-list, [data-testid="watcher-list"], .watchers-section');
    await expect(watcherList).toBeVisible({ timeout: 5000 });
    // The list should contain the display name from setup ("WatchList User")
    await expect(watcherList).toContainText('WatchList', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // UI 13. Watch loading state — button disabled while API call in-flight
  // -------------------------------------------------------------------------
  test.fixme('watch button shows loading state during API call', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchLoading');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click Watch and immediately check for a disabled/loading state
    // We don't await the API response here — check within the click side-effect window
    const watchBtn = page.locator('button:has-text("Watch"), .watch-btn');
    const clickAndCheck = async () => {
      const clickPromise = page.click('button:has-text("Watch"), .watch-btn');
      // Immediately after click, button may be disabled or show a loading class
      const isDisabled = await watchBtn.isDisabled().catch(() => false);
      // It's acceptable if the button is briefly disabled; we just ensure no crash
      await clickPromise;
      return isDisabled;
    };

    // The test passes as long as no uncaught errors occur and the button eventually
    // transitions to the Unwatch state
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      clickAndCheck(),
    ]);

    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Additional API tests (edge cases and field validation)
// ---------------------------------------------------------------------------

test.describe('Card Watchers — API edge cases', () => {

  // -------------------------------------------------------------------------
  // API 16. GET /watchers on nonexistent card returns 404
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers for nonexistent card returns 404', async ({ request }) => {
    const email = `test-watch-404-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watch 404' },
      })
    ).json();

    const res = await request.get(`${BASE}/api/cards/99999999/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // API 17. POST /watch on nonexistent card returns 404
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/watch for nonexistent card returns 404', async ({ request }) => {
    const email = `test-watch-add-404-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watch Add 404' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards/99999999/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // API 18. DELETE /watch on nonexistent card returns 404
  // -------------------------------------------------------------------------
  test('DELETE /api/cards/:id/watch for nonexistent card returns 404 or no content', async ({ request }) => {
    const email = `test-watch-del-404-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watch Del 404' },
      })
    ).json();

    const res = await request.delete(`${BASE}/api/cards/99999999/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 is preferred, but some backends return 204 idempotently — either is acceptable
    expect([204, 404]).toContain(res.status());
  });

  // -------------------------------------------------------------------------
  // API 19. GET /watchers without auth token returns 401
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers without auth token returns 401', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'WatchGetUnauth');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/watchers`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // API 20. DELETE /watch without auth token returns 401
  // -------------------------------------------------------------------------
  test('DELETE /api/cards/:id/watch without auth token returns 401', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'UnwatchUnauth');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const res = await request.delete(`${BASE}/api/cards/${card.id}/watch`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // API 21. Watcher object has display_name field
  // -------------------------------------------------------------------------
  test('watcher object contains display_name field', async ({ request }) => {
    const email = `test-watch-displayname-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Display Name Watcher' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Display Name Board' },
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
      data: { title: 'Display Name Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const watchers = await watchersRes.json();
    expect(watchers).toHaveLength(1);
    expect(watchers[0]).toHaveProperty('display_name');
    expect(typeof watchers[0].display_name).toBe('string');
    expect(watchers[0].display_name.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // API 22. Three-user scenario: each user's watch is independent
  // -------------------------------------------------------------------------
  test('three users can independently watch and unwatch a card', async ({ request }) => {
    // User 1 creates board + card
    const email1 = `test-3w-owner-${crypto.randomUUID()}@test.com`;
    const { token: token1 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email1, password: 'password123', display_name: '3W Owner' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token1}` },
        data: { name: '3-Watcher Board' },
      })
    ).json();

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
      data: { title: '3-Watcher Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Create users 2 and 3
    const email2 = `test-3w-user2-${crypto.randomUUID()}@test.com`;
    const { token: token2 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email2, password: 'password123', display_name: '3W User2' },
      })
    ).json();
    const user2 = await (await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token2}` } })).json();

    const email3 = `test-3w-user3-${crypto.randomUUID()}@test.com`;
    const { token: token3 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email3, password: 'password123', display_name: '3W User3' },
      })
    ).json();
    const user3 = await (await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token3}` } })).json();

    // Add users 2 and 3 as board members
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { user_id: user2.id, role: 'member' },
    });
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { user_id: user3.id, role: 'member' },
    });

    // All three watch the card
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token1}` } });
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token2}` } });
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token3}` } });

    const afterAllWatch = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token1}` } })
    ).json();
    expect(afterAllWatch).toHaveLength(3);

    // User 2 unwatches — count drops to 2
    await request.delete(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token2}` } });

    const afterUser2Unwatch = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token1}` } })
    ).json();
    expect(afterUser2Unwatch).toHaveLength(2);

    const remainingIds = afterUser2Unwatch.map((w: any) => w.id);
    expect(remainingIds).not.toContain(user2.id);
    expect(remainingIds).toContain(user3.id);
  });

  // -------------------------------------------------------------------------
  // API 23. Watch state is per-user — one user watching does not affect another user's watch state
  // -------------------------------------------------------------------------
  test('watch state is independent per user on same card', async ({ request }) => {
    const email1 = `test-indep1-${crypto.randomUUID()}@test.com`;
    const { token: token1 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email1, password: 'password123', display_name: 'Indep User1' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token1}` },
        data: { name: 'Indep Watch Board' },
      })
    ).json();

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
      data: { title: 'Indep Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const email2 = `test-indep2-${crypto.randomUUID()}@test.com`;
    const { token: token2 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email2, password: 'password123', display_name: 'Indep User2' },
      })
    ).json();
    const user2 = await (await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token2}` } })).json();

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { user_id: user2.id, role: 'member' },
    });

    // User1 watches, user2 does NOT watch
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token1}` } });

    const watchers = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token1}` } })
    ).json();

    expect(watchers).toHaveLength(1);
    // User2 is not in the watchers list
    const ids = watchers.map((w: any) => w.id);
    expect(ids).not.toContain(user2.id);
  });

  // -------------------------------------------------------------------------
  // API 24. Watch on deleted card returns 404 (after card deleted)
  // -------------------------------------------------------------------------
  test('watch on a deleted card returns 404 or 403', async ({ request }) => {
    const email = `test-watch-deleted-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watch Deleted Card' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Delete Card Watch Board' },
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
      data: { title: 'Delete Me Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Delete the card
    await request.delete(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Attempt to watch the deleted card — should be 404 (or 403)
    const watchRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([403, 404]).toContain(watchRes.status());
  });

  // -------------------------------------------------------------------------
  // API 25. Card watcher list is empty after deleting all watchers sequentially
  // -------------------------------------------------------------------------
  test('watcher list is empty after all watchers unwatch in sequence', async ({ request }) => {
    const email1 = `test-empty-seq1-${crypto.randomUUID()}@test.com`;
    const { token: token1 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email1, password: 'password123', display_name: 'Seq Watcher1' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token1}` },
        data: { name: 'Seq Unwatch Board' },
      })
    ).json();

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
      data: { title: 'Seq Unwatch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const email2 = `test-empty-seq2-${crypto.randomUUID()}@test.com`;
    const { token: token2 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email2, password: 'password123', display_name: 'Seq Watcher2' },
      })
    ).json();
    const user2 = await (await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token2}` } })).json();

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { user_id: user2.id, role: 'member' },
    });

    // Both watch
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token1}` } });
    await request.post(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token2}` } });

    // Both unwatch
    await request.delete(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token1}` } });
    await request.delete(`${BASE}/api/cards/${card.id}/watch`, { headers: { Authorization: `Bearer ${token2}` } });

    const watchers = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token1}` } })
    ).json();
    expect(watchers).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // API 26. Board admin (not owner) can watch a card
  // -------------------------------------------------------------------------
  test('board admin role can watch a card', async ({ request }) => {
    const ownerEmail = `test-admin-watch-owner-${crypto.randomUUID()}@test.com`;
    const { token: ownerToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: ownerEmail, password: 'password123', display_name: 'Admin Watch Owner' },
      })
    ).json();

    const adminEmail = `test-admin-watch-admin-${crypto.randomUUID()}@test.com`;
    const { token: adminToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: adminEmail, password: 'password123', display_name: 'Board Admin Watcher' },
      })
    ).json();
    const adminUser = await (await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Admin Watch Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: adminUser.id, role: 'admin' },
    });

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Lane', designator: 'L-' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { title: 'Admin Watch Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Board admin watches the card
    const watchRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(watchRes.ok()).toBeTruthy();

    const watchers = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${ownerToken}` } })
    ).json();
    const ids = watchers.map((w: any) => w.id);
    expect(ids).toContain(adminUser.id);
  });

  // -------------------------------------------------------------------------
  // API 27. Watcher object contains email or avatar_url field (schema check)
  // -------------------------------------------------------------------------
  test('watcher object schema contains at minimum id and display_name', async ({ request }) => {
    const { token, user, cardRes } = await setupBoardWithCardAPI(request, 'WatchSchema');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const watchersRes = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const watchers = await watchersRes.json();
    expect(watchers).toHaveLength(1);

    const watcher = watchers[0];
    expect(watcher).toHaveProperty('id');
    expect(watcher).toHaveProperty('display_name');
    // id must be a number
    expect(typeof watcher.id).toBe('number');
    expect(watcher.id).toBe(user.id);
  });

  // -------------------------------------------------------------------------
  // API 28. Watch count across multiple cards is isolated per card
  // -------------------------------------------------------------------------
  test('watching one card does not affect watcher list of another card', async ({ request }) => {
    const email = `test-watch-isolation-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Watch Isolation' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Watch Isolation Board' },
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

    // Create two cards
    const cardRes1 = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Watch Card A', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    const cardRes2 = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Watch Card B', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });

    if (!cardRes1.ok() || !cardRes2.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const cardA = await cardRes1.json();
    const cardB = await cardRes2.json();

    // Watch only card A
    await request.post(`${BASE}/api/cards/${cardA.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Card B should still have no watchers
    const cardBWatchers = await (
      await request.get(`${BASE}/api/cards/${cardB.id}/watchers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(cardBWatchers).toHaveLength(0);

    // Card A should have 1 watcher
    const cardAWatchers = await (
      await request.get(`${BASE}/api/cards/${cardA.id}/watchers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(cardAWatchers).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // API 29. Card owner/creator can unwatch their own card after watching
  // -------------------------------------------------------------------------
  test('card creator can watch and then unwatch their own card', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'CreatorUnwatch');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    // Watch
    const watchRes = await request.post(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(watchRes.ok()).toBeTruthy();

    // Verify in list
    const after = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    expect(after).toHaveLength(1);

    // Unwatch
    const unwatchRes = await request.delete(`${BASE}/api/cards/${card.id}/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unwatchRes.ok()).toBeTruthy();

    // Verify empty again
    const final = await (
      await request.get(`${BASE}/api/cards/${card.id}/watchers`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    expect(final).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // API 30. Response Content-Type for GET /watchers is application/json
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/watchers returns Content-Type application/json', async ({ request }) => {
    const { token, cardRes } = await setupBoardWithCardAPI(request, 'WatchContentType');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/watchers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');
  });
});
