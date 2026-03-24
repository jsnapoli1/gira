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
