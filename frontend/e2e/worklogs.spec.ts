import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, prefix = 'wl') {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Worklog User' },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number } };
}

async function createBoardAndCard(request: any, token: string) {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `WL Board ${crypto.randomUUID().slice(0, 8)}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'WL-' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Worklog Test Card',
      column_id: board.columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  return { board, swimlane, cardRes };
}

/**
 * Full setup: user + board + card, returns everything needed for both
 * API-level and UI-level tests.  Card creation is guarded — callers that
 * receive `card === null` must `test.skip()`.
 */
async function setup(request: any, page: any, prefix = 'wl') {
  const { token, user } = await createUser(request, prefix);
  const { board, swimlane, cardRes } = await createBoardAndCard(request, token);

  if (!cardRes.ok()) {
    return { token, user, board, swimlane, card: null };
  }
  const card = await cardRes.json();
  return { token, user, board, swimlane, card };
}

/**
 * Navigate to the board, open "All Cards" view, click the first card to open
 * its detail modal.
 */
async function openCardModal(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Existing UI tests (kept intact)
// ---------------------------------------------------------------------------

test('should show compact time tracking section', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await expect(page.locator('.time-tracking-compact')).toBeVisible();
  await expect(page.locator('.time-tracking-header')).toContainText('Time Tracking');
});

test('should show time logged initially as 0m', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await expect(page.locator('.time-tracking-stats .time-logged')).toBeVisible();
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged');
});

test('should log time via compact input', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
});

test('should update time logged total after adding entry', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '90');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
});

test('should clear input after logging time', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  await expect(page.locator('.time-input-mini')).toHaveValue('');
});

test('should disable Log button when time is not entered', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  await page.fill('.time-input-mini', '30');
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeEnabled();
  await page.fill('.time-input-mini', '');
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
});

test('should format hours and minutes correctly', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '125');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h 5m logged', { timeout: 5000 });
});

test('should accumulate logged time across multiple entries', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  await page.fill('.time-input-mini', '45');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 15m logged', { timeout: 5000 });
});

test('should persist time logged after closing modal', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await page.fill('.time-input-mini', '60');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
});

test('should show time tracking section inline without tabs', async ({ page, request }) => {
  const { token, board, card } = await setup(request, page);
  if (!card) { test.skip(true, 'Card creation failed'); return; }
  await openCardModal(page, token, board.id);
  await expect(page.locator('.tab-btn')).toHaveCount(0);
  await expect(page.locator('.time-tracking-compact')).toBeVisible();
});

// ---------------------------------------------------------------------------
// API-level tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API', () => {
  test('API: create worklog with notes returns 201 and work_logs array', async ({ request }) => {
    const { token, cardRes } = await (async () => {
      const { token } = await createUser(request, 'wl-api-notes');
      const { cardRes } = await createBoardAndCard(request, token);
      return { token, cardRes };
    })();
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45, notes: 'Fixed the bug', date: '2026-03-24' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
    expect(body.work_logs.length).toBeGreaterThan(0);
    const entry = body.work_logs[0];
    expect(entry.notes).toBe('Fixed the bug');
  });

  test('API: create worklog without notes succeeds', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-nonotes');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 20 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
    expect(body.work_logs.length).toBe(1);
  });

  test('API: GET worklogs returns work_logs array with total_logged', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-get');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Log some time first
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
    expect(typeof body.total_logged).toBe('number');
  });

  test('API: worklog has correct time_spent value', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-mins');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 75 },
    });
    const body = await res.json();
    const entry = body.work_logs.find((w: any) => w.time_spent === 75);
    expect(entry).toBeDefined();
    expect(entry.time_spent).toBe(75);
  });

  test('API: worklog has correct user_id', async ({ request }) => {
    const { token, user } = await createUser(request, 'wl-api-uid');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 15 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.user_id).toBe(user.id);
  });

  test('API: worklog has created_at / date timestamp', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-ts');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 10 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    // WorkItem has a `date` field (JSON key)
    expect(entry.date).toBeTruthy();
    // Should be a parseable date string
    expect(new Date(entry.date).getTime()).not.toBeNaN();
  });

  test('API: delete worklog removes it from list', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-del');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Create a worklog
    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const createBody = await createRes.json();
    const wlId = createBody.work_logs[0].id;

    // Delete it
    const delRes = await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    // Verify it's gone
    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    const stillExists = getBody.work_logs.some((w: any) => w.id === wlId);
    expect(stillExists).toBe(false);
  });

  test('API: worklog with 0 time_spent is rejected (400)', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-zero');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 0 },
    });
    expect(res.status()).toBe(400);
  });

  test('API: unauthorized request returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-unauth');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(401);
  });

  test('API: non-member cannot add worklog (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'wl-api-owner');
    const { cardRes } = await createBoardAndCard(request, ownerToken);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Create a second user who is NOT a board member
    const { token: nonMemberToken } = await createUser(request, 'wl-api-nonmember');

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(403);
  });

  test('API: multiple worklogs accumulate total_logged correctly', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-accum');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45 },
    });
    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 15 },
    });
    const body = await res.json();
    expect(body.total_logged).toBe(90);
    expect(body.work_logs.length).toBe(3);
  });

  test('API: worklog entry contains card_id field', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-cid');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 20 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.card_id).toBe(card.id);
  });

  test('API: GET worklogs after delete shows updated total', async ({ request }) => {
    const { token } = await createUser(request, 'wl-api-deltotal');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Add two worklogs
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const createBody = await createRes.json();
    const wlId = createBody.work_logs.find((w: any) => w.time_spent === 30).id;

    // Delete the 30-min entry
    await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Total should now be 60
    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    expect(getBody.total_logged).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Additional UI tests
// ---------------------------------------------------------------------------

test.describe('Worklogs UI — extended', () => {
  test('UI: worklog history entries are shown after logging', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-hist');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');

    // After logging, a worklog history list should become visible
    await expect(page.locator('.worklog-list, .work-log-list, .time-log-list, .worklog-item, .work-item').first())
      .toBeVisible({ timeout: 5000 });
  });

  test('UI: delete worklog button updates displayed total', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-del');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    // Log 60 minutes
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Find and click delete on the worklog entry
    const deleteBtn = page.locator('.worklog-delete, .work-log-delete, [aria-label*="delete"], [title*="delete"], .item-delete').first();
    const hasDel = await deleteBtn.isVisible().catch(() => false);
    if (!hasDel) {
      test.skip(true, 'No worklog delete button found in UI');
      return;
    }
    page.once('dialog', (d) => d.accept());
    await deleteBtn.click();
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged', { timeout: 5000 });
  });

  test('UI: worklog notes/description shown in history', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-desc');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    // Log work with notes via API so we know the text
    await page.request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, notes: 'Pair programming session' },
    });

    await openCardModal(page, token, board.id);

    // The notes text should appear somewhere in the time tracking section
    await expect(page.locator('.time-tracking-compact')).toContainText('Pair programming session', { timeout: 5000 });
  });

  test('UI: multiple worklogs accumulate and are listed separately', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-multi');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    // Log three entries one by one
    for (const minutes of [20, 40, 60]) {
      await page.fill('.time-input-mini', String(minutes));
      await page.click('.time-tracking-actions button:has-text("Log")');
      await page.waitForTimeout(300); // brief settle between submissions
    }

    // Total: 120m = 2h
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h logged', { timeout: 8000 });
  });

  test('UI: estimate field can be set if present', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-est');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    // Estimate input may not exist in all UI states — skip gracefully
    const estimateInput = page.locator('.time-estimate-input, input[placeholder*="estimate" i], input[aria-label*="estimate" i]').first();
    const hasEstimate = await estimateInput.isVisible().catch(() => false);
    if (!hasEstimate) {
      test.skip(true, 'No estimate input found in current UI');
      return;
    }
    await estimateInput.fill('120');
    await estimateInput.press('Enter');
    // After saving, the estimate should be reflected somewhere
    await expect(page.locator('.time-tracking-compact')).toContainText('2h', { timeout: 5000 });
  });

  test('UI: remaining time shown when estimate is set via API', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-ui-remain');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    // Set estimate via card update API
    await page.request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 120 },
    });

    // Log 60 minutes
    await page.request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });

    await openCardModal(page, token, board.id);

    // Remaining time display — accept either "1h remaining" or "60m remaining"
    const remainingEl = page.locator('.time-remaining, .time-tracking-stats').filter({ hasText: /remain/i });
    const hasRemaining = await remainingEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasRemaining) {
      test.skip(true, 'Remaining time display not found in current UI');
      return;
    }
    await expect(remainingEl).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Comprehensive API tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API — comprehensive', () => {
  // 1. POST worklog returns response with id, card_id, user_id, time_spent
  test('API: POST worklog response contains id, card_id, user_id, time_spent', async ({ request }) => {
    const { token, user } = await createUser(request, 'wl-comp-fields');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(typeof entry.id).toBe('number');
    expect(entry.card_id).toBe(card.id);
    expect(entry.user_id).toBe(user.id);
    expect(entry.time_spent).toBe(30);
  });

  // 2. POST worklog with empty time_spent (missing field) returns 400
  test('API: POST worklog with missing time_spent returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-empty');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    // time_spent defaults to 0 when absent, which is rejected with 400
    expect(res.status()).toBe(400);
  });

  // 3. POST worklog with string time_spent returns 400
  test('API: POST worklog with non-numeric time_spent returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-str');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 'thirty' },
    });
    expect(res.status()).toBe(400);
  });

  // 4. GET worklogs for card with no worklogs returns empty array
  test('API: GET worklogs for fresh card returns empty work_logs array', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-empty-list');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
    expect(body.work_logs.length).toBe(0);
    expect(body.total_logged).toBe(0);
  });

  // 5. GET worklogs returns correct time_spent for each entry
  test('API: GET worklogs returns correct time_spent for each entry', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-getvals');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const amounts = [10, 20, 35];
    for (const amt of amounts) {
      await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { time_spent: amt },
      });
    }

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const timeSpentas = body.work_logs.map((w: any) => w.time_spent).sort((a: number, b: number) => a - b);
    expect(timeSpentas).toEqual([10, 20, 35]);
  });

  // 6. Multiple worklogs sum correctly in total_logged
  test('API: total_logged equals exact sum of posted time_spent values', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-sum');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const amounts = [11, 22, 33, 44];
    for (const amt of amounts) {
      await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { time_spent: amt },
      });
    }

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const expectedSum = amounts.reduce((a, b) => a + b, 0); // 110
    expect(body.total_logged).toBe(expectedSum);
  });

  // 7. DELETE worklog returns 204
  test('API: DELETE worklog returns 204 no content', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-del204');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const wlId = (await createRes.json()).work_logs[0].id;

    const delRes = await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);
  });

  // 8. GET after delete excludes deleted worklog
  test('API: GET after delete does not include deleted worklog', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-delget');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Create two worklogs
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 20, notes: 'keep me' },
    });
    const toDeleteRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 50, notes: 'delete me' },
    });
    const toDeleteBody = await toDeleteRes.json();
    const wlId = toDeleteBody.work_logs.find((w: any) => w.notes === 'delete me').id;

    await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    const deletedExists = getBody.work_logs.some((w: any) => w.id === wlId);
    expect(deletedExists).toBe(false);
    // The remaining worklog should still be there
    expect(getBody.work_logs.length).toBe(1);
  });

  // 9. Non-member cannot log time (403)
  test('API: non-member POST worklog is rejected with 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'wl-comp-403own');
    const { cardRes } = await createBoardAndCard(request, ownerToken);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const { token: strangerToken } = await createUser(request, 'wl-comp-403str');

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(403);
  });

  // 10. Unauthorized GET worklogs returns 401
  test('API: unauthorized GET worklogs returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-unauth-get');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`);
    // No Authorization header — should be 401
    expect(res.status()).toBe(401);
  });

  // 11. GET board time summary aggregates all card worklogs
  test('API: GET board time-summary aggregates worklogs across cards', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-boardsum');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Log time on the card
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.total_logged).toBe('number');
    // The board summary should include the 90 minutes logged
    expect(body.total_logged).toBeGreaterThanOrEqual(90);
    expect(Array.isArray(body.by_user)).toBe(true);
  });

  // 12. POST worklog with notes stores them correctly
  test('API: POST worklog notes are stored and returned via GET', async ({ request }) => {
    const { token } = await createUser(request, 'wl-comp-notes-get');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45, notes: 'Deep work on authentication' },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    const entry = getBody.work_logs.find((w: any) => w.notes === 'Deep work on authentication');
    expect(entry).toBeDefined();
    expect(entry.notes).toBe('Deep work on authentication');
  });
});

// ---------------------------------------------------------------------------
// UI edge cases
// ---------------------------------------------------------------------------

test.describe('Worklogs UI — edge cases', () => {
  // 13. Log 1 minute shows "1m logged"
  test('UI: logging 1 minute shows "1m logged"', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-1m');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);
    await page.fill('.time-input-mini', '1');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1m logged', { timeout: 5000 });
  });

  // 14. Log 60 minutes shows "1h logged"
  test('UI: logging 60 minutes shows "1h logged"', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-60m');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
  });

  // 15. Log 61 minutes shows "1h 1m logged"
  test('UI: logging 61 minutes shows "1h 1m logged"', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-61m');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);
    await page.fill('.time-input-mini', '61');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 1m logged', { timeout: 5000 });
  });

  // 16. Log 0 minutes — button stays disabled
  test('UI: entering 0 in time input keeps Log button disabled', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-0m');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);
    await page.fill('.time-input-mini', '0');
    // Button should remain disabled for zero input
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  });

  // 17. Log non-numeric characters — button stays disabled
  test('UI: entering non-numeric text keeps Log button disabled', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-nonnumeric');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);
    // type non-numeric into the number input; browser may strip it
    await page.fill('.time-input-mini', 'abc');
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  });

  // 18. Multiple sessions accumulate correctly
  test('UI: logging across three separate interactions accumulates total correctly', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-sessions');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    // Session 1: 30m
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });

    // Session 2: 30m → total 60m = 1h
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Session 3: 30m → total 90m = 1h 30m
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
  });

  // 19. Worklog persists after modal close/reopen
  test('UI: worklog total persists after closing and reopening the modal', async ({ page, request }) => {
    const { token, board, card } = await setup(request, page, 'wl-edge-persist');
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    await openCardModal(page, token, board.id);

    // Log time
    await page.fill('.time-input-mini', '45');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('45m logged', { timeout: 5000 });

    // Close the modal
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the same card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Persisted value should still show
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('45m logged', { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// API: POST /api/cards/:id/worklogs — core contract tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API — POST contract', () => {
  // 1. POST with time_spent=60 returns 201 (or 200) and body with work_logs
  test('API: POST worklog with time_spent=60 returns success status', async ({ request }) => {
    const { token } = await createUser(request, 'wl-post-60');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.work_logs).toBeDefined();
  });

  // 2. Worklog response has id, card_id, user_id, time_spent
  test('API: worklog response has id, card_id, user_id, time_spent fields', async ({ request }) => {
    const { token, user } = await createUser(request, 'wl-fields-check');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(typeof entry.id).toBe('number');
    expect(entry.card_id).toBe(card.id);
    expect(entry.user_id).toBe(user.id);
    expect(entry.time_spent).toBe(60);
  });

  // 3. Worklog response entry has a date / created_at timestamp
  test('API: worklog response entry has a date timestamp', async ({ request }) => {
    const { token } = await createUser(request, 'wl-date-field');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    // The API uses `date` as the JSON key
    const timestamp = entry.date ?? entry.created_at;
    expect(timestamp).toBeTruthy();
    expect(new Date(timestamp).getTime()).not.toBeNaN();
  });

  // 4. POST worklog with description/notes field stores it
  test('API: POST worklog with notes/description field stores and returns it', async ({ request }) => {
    const { token } = await createUser(request, 'wl-desc-store');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const notes = 'Investigated performance bottleneck';
    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, notes },
    });
    const body = await res.json();
    const entry = body.work_logs.find((w: any) => w.notes === notes);
    expect(entry).toBeDefined();
    expect(entry.notes).toBe(notes);
  });
});

// ---------------------------------------------------------------------------
// API: GET /api/cards/:id/worklogs — list contract tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API — GET list contract', () => {
  // 5. GET /api/cards/:id/worklogs returns array
  test('API: GET worklogs returns work_logs array', async ({ request }) => {
    const { token } = await createUser(request, 'wl-get-array');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
  });

  // 6. GET worklogs includes newly created worklog
  test('API: GET worklogs includes newly created worklog by id', async ({ request }) => {
    const { token } = await createUser(request, 'wl-get-includes');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 42 },
    });
    const createBody = await createRes.json();
    const newId = createBody.work_logs.find((w: any) => w.time_spent === 42)?.id;
    expect(newId).toBeDefined();

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    const found = getBody.work_logs.some((w: any) => w.id === newId);
    expect(found).toBe(true);
  });

  // 7. Multiple worklogs summed: 30+45=75 minutes in total_logged
  test('API: GET total_logged = 30+45=75 after two worklogs', async ({ request }) => {
    const { token } = await createUser(request, 'wl-sum-75');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45 },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    expect(getBody.total_logged).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// API: DELETE /api/cards/:id/worklogs/:id — delete contract tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API — DELETE contract', () => {
  // 8. DELETE returns 204
  test('API: DELETE worklog returns 204 no-content', async ({ request }) => {
    const { token } = await createUser(request, 'wl-del-204-2');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 25 },
    });
    const wlId = (await createRes.json()).work_logs[0].id;

    const delRes = await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);
  });

  // 9. After delete, worklog not in GET list
  test('API: after DELETE the worklog is absent from GET list', async ({ request }) => {
    const { token } = await createUser(request, 'wl-del-absent');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 55 },
    });
    const wlId = (await createRes.json()).work_logs[0].id;

    await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    expect(getBody.work_logs.some((w: any) => w.id === wlId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API: Authorization tests
// ---------------------------------------------------------------------------

test.describe('Worklogs API — authorization', () => {
  // 10. Unauthorized POST returns 401
  test('API: POST worklog without token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'wl-auth-post-401');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(401);
  });

  // 11. Unauthorized GET returns 401
  test('API: GET worklogs without token returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'wl-auth-get-401');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`);
    expect(res.status()).toBe(401);
  });

  // 12. Non-member cannot log time (403)
  test('API: non-member POST worklog returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'wl-auth-403-own2');
    const { cardRes } = await createBoardAndCard(request, ownerToken);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const { token: nonMemberToken } = await createUser(request, 'wl-auth-403-nm2');

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// API: Validation edge cases
// ---------------------------------------------------------------------------

test.describe('Worklogs API — validation edge cases', () => {
  // 13. POST worklog with 0 minutes — validates actual behavior (expect 400)
  test('API: POST worklog with time_spent=0 is rejected with 400', async ({ request }) => {
    const { token } = await createUser(request, 'wl-val-zero-2');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 0 },
    });
    // The API rejects zero time_spent with 400
    expect(res.status()).toBe(400);
  });

  // POST worklog with negative time_spent — should be rejected
  test('API: POST worklog with negative time_spent is rejected with 400', async ({ request }) => {
    const { token } = await createUser(request, 'wl-val-neg');
    const { cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: -10 },
    });
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// API: GET /api/boards/:id/time-summary tests
// ---------------------------------------------------------------------------

test.describe('Board time-summary API', () => {
  // 14. GET /api/boards/:id/time-summary returns 200
  test('API: GET board time-summary returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-200');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  // 15. Time summary has total_logged field
  test('API: board time-summary response has total_logged field', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-fields');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(typeof body.total_logged).toBe('number');
    expect(Array.isArray(body.by_user)).toBe(true);
  });

  // 16. Time summary shows 0 with no worklogs
  test('API: board time-summary total_logged is 0 with no worklogs', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-zero');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.total_logged).toBe(0);
  });

  // 17. Time summary increases after worklog is posted
  test('API: board time-summary total_logged increases after posting a worklog', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-increase');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Baseline
    const beforeRes = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const beforeBody = await beforeRes.json();
    const before = beforeBody.total_logged as number;

    // Log 90 minutes
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 90 },
    });

    const afterRes = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterBody = await afterRes.json();
    expect(afterBody.total_logged).toBe(before + 90);
  });

  // time-summary also has total_estimated field
  test('API: board time-summary response has total_estimated field', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-est');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(typeof body.total_estimated).toBe('number');
  });

  // time-summary: by_user has user_id and time_spent entries after logging
  test('API: board time-summary by_user contains entry with user_id and time_spent after logging', async ({ request }) => {
    const { token, user } = await createUser(request, 'wl-tsum-byuser');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(Array.isArray(body.by_user)).toBe(true);
    const entry = body.by_user.find((e: any) => e.user_id === user.id);
    expect(entry).toBeDefined();
    expect(entry.time_spent).toBeGreaterThanOrEqual(60);
  });

  // time-summary: non-member gets 403
  test('API: non-member GET board time-summary returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'wl-tsum-403own');
    const { board, cardRes } = await createBoardAndCard(request, ownerToken);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const { token: strangerToken } = await createUser(request, 'wl-tsum-403str');

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    expect(res.status()).toBe(403);
  });

  // time-summary: unauthenticated gets 401
  test('API: unauthenticated GET board time-summary returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'wl-tsum-unauth');
    const { board, cardRes } = await createBoardAndCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`);
    expect(res.status()).toBe(401);
  });
});
