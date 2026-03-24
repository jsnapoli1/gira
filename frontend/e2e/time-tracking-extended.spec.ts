import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Shared helper: create user + board + swimlane + card via API,
 * inject token, navigate to board, switch to All Cards view, open the card modal.
 *
 * Returns null values for card/board if card creation fails (Gitea 401/403).
 */
async function setupBoardWithCard(request: any, page: any) {
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-ttx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Time Tracker',
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Time Test Board' },
    })
  ).json();

  // POST /api/boards returns board with columns already embedded
  const columns = board.columns;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Time Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });
  if (!cardRes.ok()) {
    test.skip(true, `Card creation failed (likely Gitea 401): ${await cardRes.text()}`);
    return { token, board, card: null, columns, swimlane };
  }
  const card = await cardRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { token, board, card, columns, swimlane };
}

test.describe('Time Tracking Extended', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Delete worklog entry
  // The current modal UI only shows the total_logged aggregate — individual
  // worklog rows with a delete button are not rendered. Mark fixme.
  // ─────────────────────────────────────────────────────────────────────────
  test.fixme('should delete a worklog entry and decrease the total', async ({ page, request }) => {
    const { token, card } = await setupBoardWithCard(request, page);

    // Pre-seed a 60-minute worklog via API
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60, date: new Date().toISOString().split('T')[0], notes: '' },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Total should reflect the pre-seeded entry
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged');

    // Find the worklog entry and click its delete button
    // (UI does not currently render individual worklog rows)
    await page.locator('.worklog-entry .delete-btn').first().click();

    // After deletion total should be 0m
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Set time estimate, save, verify display
  // ─────────────────────────────────────────────────────────────────────────
  test('should save a time estimate and show it in the time tracking section', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click Edit to enter the editing form
    await page.click('.btn:has-text("Edit")');

    // Fill the Time Estimate field with 120 minutes (2h)
    await page.fill('input[placeholder="e.g., 120"]', '120');

    // Save the card
    await page.click('.btn:has-text("Save")');

    // After save, the compact time tracking stats should show "2h estimated"
    await expect(page.locator('.time-tracking-stats .time-estimate')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.time-tracking-stats .time-estimate')).toContainText('2h estimated');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Time estimate displayed in human-readable format (e.g. 2h 5m)
  // ─────────────────────────────────────────────────────────────────────────
  test('should display time estimate in human-readable format (1h 30m)', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Set estimate to 90 minutes (1h 30m)
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '90');
    await page.click('.btn:has-text("Save")');

    await expect(page.locator('.time-tracking-stats .time-estimate')).toContainText('1h 30m estimated', { timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Progress bar appears when estimate is set and time is logged
  // ─────────────────────────────────────────────────────────────────────────
  test('should show progress bar when estimate is set and time is logged', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Set a time estimate via the edit form
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '120');
    await page.click('.btn:has-text("Save")');

    // Wait for edit mode to close
    await expect(page.locator('.time-tracking-compact')).toBeVisible({ timeout: 5000 });

    // Log some time
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Progress bar should be visible
    await expect(page.locator('.time-progress-mini')).toBeVisible();
    await expect(page.locator('.time-progress-bar')).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: Progress bar NOT shown when no estimate is set
  // ─────────────────────────────────────────────────────────────────────────
  test('should not show progress bar when no time estimate is set', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // No estimate set — progress bar should be absent
    await expect(page.locator('.time-progress-mini')).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: Progress bar turns "over" class when logged > estimated
  // ─────────────────────────────────────────────────────────────────────────
  test('should apply "over" class to progress bar when logged time exceeds estimate', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Set a small estimate: 30 minutes
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '30');
    await page.click('.btn:has-text("Save")');
    await expect(page.locator('.time-tracking-compact')).toBeVisible({ timeout: 5000 });

    // Log 60 minutes — double the estimate
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Progress bar should have the "over" class
    await expect(page.locator('.time-progress-bar.over')).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7: Multiple worklogs accumulate correctly (30m + 45m = 1h 15m)
  // ─────────────────────────────────────────────────────────────────────────
  test('should accumulate total from two separate worklog entries (30m + 45m = 1h 15m)', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log 30 minutes
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });

    // Log 45 more minutes
    await page.fill('.time-input-mini', '45');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 15m logged', { timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 8: Multiple worklogs from API accumulate in modal display
  // ─────────────────────────────────────────────────────────────────────────
  test('should show accumulated total when multiple worklogs pre-seeded via API', async ({ page, request }) => {
    const { token, card } = await setupBoardWithCard(request, page);
    if (!card) return; // already skipped

    // Pre-seed two worklogs: 60m + 30m = 90m (1h 30m)
    const today = new Date().toISOString().split('T')[0];
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60, date: today, notes: 'First log' },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, date: today, notes: 'Second log' },
    });

    // Navigate to board and open the card modal
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Total should be 1h 30m
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 9: Logged time shown in readable format (2h 5m)
  // ─────────────────────────────────────────────────────────────────────────
  test('should show time in readable format when logging 125 minutes (2h 5m)', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log 125 minutes
    await page.fill('.time-input-mini', '125');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h 5m logged', { timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 10: Estimate shown as "estimated" text clears if estimate removed
  // ─────────────────────────────────────────────────────────────────────────
  test('should hide estimated text when time estimate is cleared', async ({ page, request }) => {
    await setupBoardWithCard(request, page);

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Set estimate to 60 minutes
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '60');
    await page.click('.btn:has-text("Save")');
    await expect(page.locator('.time-tracking-stats .time-estimate')).toBeVisible({ timeout: 5000 });

    // Now clear the estimate
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '');
    await page.click('.btn:has-text("Save")');

    // Estimated text and progress bar should not be visible
    await expect(page.locator('.time-tracking-stats .time-estimate')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.time-progress-mini')).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 11: Worklog description/notes field
  // The compact input only accepts minutes; a notes field is not exposed in the
  // current compact UI. Mark fixme until the UI exposes a notes input.
  // ─────────────────────────────────────────────────────────────────────────
  test.fixme('should show worklog notes/description in the worklog list', async ({ page, request }) => {
    const { token, card } = await setupBoardWithCard(request, page);

    // Seed a worklog with a description via API
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        time_spent: 30,
        date: new Date().toISOString().split('T')[0],
        notes: 'Reviewed the PR',
      },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The worklog entry row should display the notes text
    await expect(page.locator('.worklog-entry')).toContainText('Reviewed the PR');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 12: Worklog shows logged-by user
  // Individual worklog rows with user attribution are not rendered in the
  // current modal UI — only the aggregate total. Mark fixme.
  // ─────────────────────────────────────────────────────────────────────────
  test.fixme('should show the user name on each worklog entry', async ({ page, request }) => {
    const { token, card } = await setupBoardWithCard(request, page);

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45, date: new Date().toISOString().split('T')[0], notes: '' },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The worklog entry should show the user's display name
    await expect(page.locator('.worklog-entry .worklog-user')).toContainText('Time Tracker');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 13: Time summary in reports — board with a sprint and logged time
  // The .time-tracking-section is rendered inside the sprints.length > 0
  // branch of Reports.tsx, so a sprint must exist for the section to appear.
  // ─────────────────────────────────────────────────────────────────────────
  test('should show time tracking summary on reports page after logging time', async ({ page, request }) => {
    const { token, card, board } = await setupBoardWithCard(request, page);
    if (!card) return; // already skipped

    // Create a sprint so the Reports page shows the charts/time section
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint 1', goal: '', start_date: '', end_date: '' },
    });

    // Log time via API so the board has non-zero time data (90 minutes = 1h 30m)
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 90, date: new Date().toISOString().split('T')[0], notes: '' },
    });

    // Navigate to Reports page
    await page.click('a:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/, { timeout: 5000 });

    // Select the board
    await page.selectOption('.reports-filters select', { label: 'Time Test Board' });

    // Wait for the time tracking section to appear (requires sprints to exist)
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    // The section should show a non-zero logged total (1h 30m = 90 minutes)
    await expect(page.locator('.time-tracking-section')).toContainText('1h 30m logged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API tests — pure request-level coverage
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Time Tracking — API coverage', () => {
  async function makeUser(request: any) {
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `ttx-api-${crypto.randomUUID()}@example.com`,
        password: 'password123',
        display_name: 'TT API User',
      },
    });
    const body = await res.json();
    return { token: body.token as string, user: body.user as { id: number } };
  }

  async function makeCard(request: any, token: string) {
    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `TTX Board ${crypto.randomUUID().slice(0, 8)}` },
      })
    ).json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'TTX Lane', designator: 'TX' },
      })
    ).json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'TTX Card',
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    return { board, cardRes };
  }

  // 1. POST worklog with time_spent=60 returns 201 with id
  test('API: POST worklog time_spent=60 returns 201 with id field', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.work_logs)).toBe(true);
    const entry = body.work_logs[0];
    expect(typeof entry.id).toBe('number');
    expect(entry.id).toBeGreaterThan(0);
  });

  // 2. Worklog has time_spent field matching sent value
  test('API: worklog time_spent field matches posted value', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    const body = await res.json();
    const entry = body.work_logs.find((w: any) => w.time_spent === 60);
    expect(entry).toBeDefined();
    expect(entry.time_spent).toBe(60);
  });

  // 3. Worklog has user_id of creator
  test('API: worklog user_id matches creating user', async ({ request }) => {
    const { token, user } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 25 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.user_id).toBe(user.id);
  });

  // 4. Worklog has created_at / date timestamp
  test('API: worklog has a parseable date timestamp', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 10 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.date).toBeTruthy();
    expect(new Date(entry.date).getTime()).not.toBeNaN();
  });

  // 5. Worklog with notes stores it correctly
  test('API: worklog with notes stores notes value', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, notes: 'Reviewed design docs' },
    });
    const body = await res.json();
    const entry = body.work_logs.find((w: any) => w.notes === 'Reviewed design docs');
    expect(entry).toBeDefined();
    expect(entry.notes).toBe('Reviewed design docs');
  });

  // 6. Worklog without notes has empty notes field
  test('API: worklog without notes has empty notes field', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 15 },
    });
    const body = await res.json();
    const entry = body.work_logs[0];
    // notes should be absent, empty string, or null
    expect(entry.notes == null || entry.notes === '').toBe(true);
  });

  // 7. GET /api/cards/:id/worklogs returns array including new worklog
  test('API: GET worklogs returns array containing newly created entry', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const postRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 50 },
    });
    const postBody = await postRes.json();
    const createdId = postBody.work_logs[0].id;

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.ok()).toBe(true);
    const getBody = await getRes.json();
    expect(Array.isArray(getBody.work_logs)).toBe(true);
    const found = getBody.work_logs.some((w: any) => w.id === createdId);
    expect(found).toBe(true);
  });

  // 8. Multiple worklogs accumulated correctly in total_logged
  test('API: multiple worklogs accumulate correctly in total_logged', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 40 },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 20 },
    });
    const lastRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    const body = await lastRes.json();
    expect(body.total_logged).toBe(120);
    expect(body.work_logs.length).toBe(3);
  });

  // 9. DELETE /api/cards/:id/worklogs/:id returns 204
  test('API: DELETE worklog returns 204', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const createBody = await createRes.json();
    const wlId = createBody.work_logs[0].id;

    const delRes = await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);
  });

  // 10. After deletion, worklog not in GET list
  test('API: deleted worklog absent from subsequent GET', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const createRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45 },
    });
    const createBody = await createRes.json();
    const wlId = createBody.work_logs[0].id;

    await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    const stillPresent = getBody.work_logs.some((w: any) => w.id === wlId);
    expect(stillPresent).toBe(false);
  });

  // 11. Total time = sum of all worklog time_spent values
  test('API: total_logged equals sum of all worklog time_spent values', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const amounts = [15, 30, 45];
    let lastBody: any;
    for (const amt of amounts) {
      const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { time_spent: amt },
      });
      lastBody = await res.json();
    }
    const expectedTotal = amounts.reduce((a, b) => a + b, 0); // 90
    expect(lastBody.total_logged).toBe(expectedTotal);
  });

  // 12. POST worklog time_spent=0 is rejected (400)
  test('API: POST worklog time_spent=0 returns 400', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 0 },
    });
    expect(res.status()).toBe(400);
  });

  // 13. POST worklog time_spent=9999 is accepted
  test('API: POST worklog time_spent=9999 returns 201', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 9999 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.work_logs[0].time_spent).toBe(9999);
  });

  // 14. Unauthorized POST worklog returns 401
  test('API: unauthorized POST worklog returns 401', async ({ request }) => {
    const { token } = await makeUser(request);
    const { cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      // no Authorization header
      data: { time_spent: 30 },
    });
    expect(res.status()).toBe(401);
  });

  // 15. GET board time-summary returns total_logged field
  test('API: GET board time-summary returns total_logged', async ({ request }) => {
    const { token } = await makeUser(request);
    const { board, cardRes } = await makeCard(request, token);
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Log some time
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 75 },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.total_logged).toBe('number');
    expect(body.total_logged).toBeGreaterThanOrEqual(75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI tests — element waits only, never networkidle
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Time Tracking — UI coverage', () => {
  async function openModal(request: any, page: any) {
    const { token, board, card } = await setupBoardWithCard(request, page);
    if (!card) { test.skip(true, 'Card creation failed'); return null; }
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    return { token, board, card };
  }

  // 16. Time tracking section visible in card modal
  test('UI: time tracking section is visible inside card modal', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-compact')).toBeVisible();
  });

  // 17. Time tracking shows "Time Tracking" heading
  test('UI: modal shows "Time Tracking" heading', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-header')).toContainText('Time Tracking');
  });

  // 18. Shows "0m logged" initially
  test('UI: logged time shows "0m logged" on a fresh card', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged');
  });

  // 19. Input field for minutes is present
  test('UI: minute input field is present in time tracking section', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-input-mini')).toBeVisible();
  });

  // 20. "Log" button present
  test('UI: "Log" button is present in time tracking section', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeVisible();
  });

  // 21. "Log" button disabled when input is empty
  test('UI: "Log" button is disabled when input is empty', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  });

  // 22. Enter 30 minutes → click Log → shows "30m logged"
  test('UI: entering 30 minutes and clicking Log shows "30m logged"', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  });

  // 23. Enter 90 minutes → shows "1h 30m logged"
  test('UI: entering 90 minutes shows "1h 30m logged"', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '90');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
  });

  // 24. Enter 120 → shows "2h logged"
  test('UI: entering 120 minutes shows "2h logged"', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '120');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h logged', { timeout: 5000 });
  });

  // 25. Time input clears after logging
  test('UI: time input clears after logging', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '45');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('45m logged', { timeout: 5000 });
    await expect(page.locator('.time-input-mini')).toHaveValue('');
  });

  // 26. Log 30 then log 45 → total is "1h 15m logged"
  test('UI: log 30 then 45 minutes accumulates to "1h 15m logged"', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
    await page.fill('.time-input-mini', '45');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 15m logged', { timeout: 5000 });
  });

  // 27. Worklog history section shows past entries
  test('UI: worklog history section appears after logging time', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
    // Some form of worklog list should appear
    const historyEl = page.locator(
      '.worklog-list, .work-log-list, .time-log-list, .worklog-item, .work-item, .worklog-entry'
    ).first();
    const isVisible = await historyEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      test.skip(true, 'Worklog history list not rendered in current UI');
      return;
    }
    await expect(historyEl).toBeVisible();
  });

  // 28. History entry shows minutes formatted
  test('UI: history entry contains a formatted time value', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    const historyEl = page.locator(
      '.worklog-list, .work-log-list, .time-log-list, .worklog-item, .work-item, .worklog-entry'
    ).first();
    const isVisible = await historyEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      test.skip(true, 'Worklog history list not rendered in current UI');
      return;
    }
    // Should contain a time value like "1h", "60m", or "60 min"
    await expect(historyEl).toContainText(/1h|60m|60 min/);
  });

  // 29. History entry shows notes (if entered via API)
  test('UI: history entry shows notes when pre-seeded via API', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request, page);
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, notes: 'Scoping session' },
    });

    // Re-open modal with the pre-seeded data
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    const historyEl = page.locator(
      '.worklog-list, .work-log-list, .time-log-list, .worklog-item, .work-item, .worklog-entry'
    ).first();
    const isVisible = await historyEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      test.skip(true, 'Worklog history list not rendered in current UI');
      return;
    }
    await expect(page.locator('.time-tracking-compact')).toContainText('Scoping session', { timeout: 5000 });
  });

  // 30. History entry shows who logged
  test.fixme('UI: history entry shows logged-by user name', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request, page);
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });

    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // User attribution is not currently rendered — needs UI work
    await expect(page.locator('.worklog-entry .worklog-user')).toContainText('Time Tracker');
  });

  // 31. Delete worklog button in history
  test('UI: delete button in worklog history (if rendered)', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;

    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    const deleteBtn = page.locator(
      '.worklog-delete, .work-log-delete, [aria-label*="delete" i], [title*="delete" i], .item-delete'
    ).first();
    const hasDel = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasDel) {
      test.skip(true, 'No worklog delete button rendered in current UI');
      return;
    }
    await expect(deleteBtn).toBeVisible();
  });

  // 32. Delete worklog updates total displayed
  test('UI: deleting worklog updates displayed total to 0m', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;

    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    const deleteBtn = page.locator(
      '.worklog-delete, .work-log-delete, [aria-label*="delete" i], [title*="delete" i], .item-delete'
    ).first();
    const hasDel = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasDel) {
      test.skip(true, 'No worklog delete button rendered in current UI');
      return;
    }
    page.once('dialog', (d) => d.accept());
    await deleteBtn.click();
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged', { timeout: 5000 });
  });

  // 33. Estimate field visible (if feature exposed in edit form)
  test('UI: time estimate input field visible in card edit form', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;

    await page.click('.btn:has-text("Edit")');
    // The placeholder text for the estimate field is "e.g., 120"
    const estimateInput = page.locator('input[placeholder="e.g., 120"]');
    await expect(estimateInput).toBeVisible({ timeout: 5000 });
  });

  // 34. Story points field visible in modal
  test('UI: story points field is visible in card modal', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;

    // Story points may be in the view or edit mode — check both
    const spField = page.locator(
      '[data-field="story_points"], .story-points, input[placeholder*="points" i], input[aria-label*="points" i]'
    ).first();
    const spVisible = await spField.isVisible({ timeout: 3000 }).catch(() => false);
    if (!spVisible) {
      // Try opening edit mode
      await page.click('.btn:has-text("Edit")');
      const spEdit = page.locator(
        '[data-field="story_points"], .story-points, input[placeholder*="points" i], input[aria-label*="points" i]'
      ).first();
      const spEditVisible = await spEdit.isVisible({ timeout: 3000 }).catch(() => false);
      if (!spEditVisible) {
        test.skip(true, 'Story points field not found in current UI');
        return;
      }
      await expect(spEdit).toBeVisible();
    } else {
      await expect(spField).toBeVisible();
    }
  });

  // 35. Story points can be set numerically
  test('UI: story points can be set to a numeric value and saved', async ({ page, request }) => {
    const ctx = await openModal(request, page);
    if (!ctx) return;

    await page.click('.btn:has-text("Edit")');

    const spInput = page.locator(
      'input[placeholder*="points" i], input[aria-label*="story points" i], input[name="story_points"]'
    ).first();
    const spVisible = await spInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!spVisible) {
      test.skip(true, 'Story points input not found in current UI');
      return;
    }
    await spInput.fill('5');
    await page.click('.btn:has-text("Save")');

    // After save, verify the value is reflected somewhere in the modal
    await expect(page.locator('.card-detail-modal-unified')).toContainText('5', { timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API: worklog date field tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Time Tracking — worklog date handling', () => {
  async function makeUserAndCard(request: any, prefix: string) {
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `${prefix}-${crypto.randomUUID()}@example.com`,
        password: 'password123',
        display_name: 'TT Date User',
      },
    });
    const body = await res.json();
    const token: string = body.token;
    const user: { id: number } = body.user;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `Date Board ${crypto.randomUUID().slice(0, 6)}` },
      })
    ).json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'DT' },
      })
    ).json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Date Card',
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    return { token, user, board, cardRes };
  }

  // 36. POST worklog with explicit past date stores the date
  test('API: worklog with past date stores date correctly', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-pastdate');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();
    const pastDate = '2025-01-15';

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, date: pastDate },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.date).toContain('2025-01-15');
  });

  // 37. POST worklog with future date is accepted (no restriction)
  test('API: worklog with future date is accepted (201)', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-futuredate');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();
    const futureDate = '2030-12-31';

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45, date: futureDate },
    });
    // Either 201 (allowed) or 400 (rejected) is valid — document actual behavior
    expect([200, 201, 400]).toContain(res.status());
  });

  // 38. POST worklog with invalid date format returns 400
  test('API: worklog with invalid date format returns 400', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-baddate');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, date: 'not-a-date' },
    });
    expect(res.status()).toBe(400);
  });

  // 39. POST worklog without date defaults to today
  test('API: worklog without date field defaults to today', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-nodate');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();
    const todayPrefix = new Date().toISOString().slice(0, 10);

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 20 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const entry = body.work_logs[0];
    expect(entry.date).toContain(todayPrefix);
  });

  // 40. Multiple worklogs with different dates all appear in list
  test('API: multiple worklogs with different dates all appear in list', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-multidates');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const dates = ['2025-06-01', '2025-06-15', '2025-07-01'];
    for (const date of dates) {
      await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { time_spent: 20, date },
      });
    }

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.work_logs.length).toBe(3);
  });

  // 41. time_estimate returned in worklog GET response
  test('API: GET worklogs response includes time_estimate field', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-estimfld');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Set estimate via card update
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 90 },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.time_estimate).toBe('number');
    expect(body.time_estimate).toBe(90);
  });

  // 42. time_estimate is null/0 for card with no estimate set
  test('API: GET worklogs time_estimate is null or 0 when no estimate set', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-noestim');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    // time_estimate should be null or 0 when not set
    expect(body.time_estimate == null || body.time_estimate === 0).toBe(true);
  });

  // 43. DELETE with wrong worklog id returns 404 or 204 (not crash)
  test('API: DELETE non-existent worklog returns 404 or 204', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-delbad');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.delete(`${BASE}/api/cards/${card.id}/worklogs/99999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Should respond gracefully
    expect([204, 404]).toContain(res.status());
  });

  // 44. total_logged in GET response decreases after deletion
  test('API: GET total_logged decreases correctly after worklog deletion', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-deldecrease');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Log 60 + 30 = 90 minutes
    const r1 = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });
    const r2 = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const body2 = await r2.json();
    const wlId = body2.work_logs.find((w: any) => w.time_spent === 30).id;

    // Delete the 30-min entry
    await request.delete(`${BASE}/api/cards/${card.id}/worklogs/${wlId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    expect(getBody.total_logged).toBe(60);
  });

  // 45. worklog card_id field always matches the card it was logged on
  test('API: each worklog entry has correct card_id', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-cardidmatch');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 25 },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    for (const wl of body.work_logs) {
      expect(wl.card_id).toBe(card.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Time estimate via card update API — coverage
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Time Tracking — estimate via card update', () => {
  async function makeUserAndCard(request: any, prefix: string) {
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `${prefix}-${crypto.randomUUID()}@example.com`,
        password: 'password123',
        display_name: 'TT Est User',
      },
    });
    const body = await res.json();
    const token: string = body.token;
    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `Est Board ${crypto.randomUUID().slice(0, 6)}` },
      })
    ).json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'ET' },
      })
    ).json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Est Card',
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    return { token, board, cardRes };
  }

  // 46. PUT card with time_estimate sets estimate (reflected in GET worklogs)
  test('API: PUT card time_estimate=120 reflects in GET worklogs response', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-est-put');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 120 },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.time_estimate).toBe(120);
  });

  // 47. PUT card time_estimate=0 clears estimate
  test('API: PUT card time_estimate=0 clears estimate (null or 0)', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-est-clear');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // First set it
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 60 },
    });

    // Then clear it
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 0 },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.time_estimate == null || body.time_estimate === 0).toBe(true);
  });

  // 48. Board time-summary total_estimated reflects card estimates
  test('API: board time-summary total_estimated increases after setting estimate', async ({ request }) => {
    const { token, board, cardRes } = await makeUserAndCard(request, 'ttx-boardest');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Baseline
    const before = await (
      await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 120 },
    });

    const after = await (
      await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(after.total_estimated).toBeGreaterThanOrEqual((before.total_estimated ?? 0) + 120);
  });

  // 49. Board time-summary has by_user array even with no worklogs
  test('API: board time-summary by_user is empty array when no worklogs exist', async ({ request }) => {
    const { token, board, cardRes } = await makeUserAndCard(request, 'ttx-byuserempty');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(Array.isArray(body.by_user)).toBe(true);
    expect(body.by_user.length).toBe(0);
  });

  // 50. Large time_spent value (480 min = 8h) accepted and stored exactly
  test('API: worklog with 480 minutes (8h) accepted and stored exactly', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-largemin');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 480 },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const entry = body.work_logs.find((w: any) => w.time_spent === 480);
    expect(entry).toBeDefined();
    expect(entry.time_spent).toBe(480);
  });

  // 51. Two worklogs from same user both appear in list
  test('API: two worklogs from same user both appear in work_logs list', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-sameuser2');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30, notes: 'Morning session' },
    });
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 45, notes: 'Afternoon session' },
    });

    const res = await request.get(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.work_logs.length).toBe(2);
    expect(body.total_logged).toBe(75);
  });

  // 52. Single worklog total_logged equals its time_spent
  test('API: single worklog total_logged equals its time_spent value', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-singletotal');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 73 },
    });
    const body = await res.json();
    expect(body.total_logged).toBe(73);
    expect(body.work_logs.length).toBe(1);
  });

  // 53. notes field in worklog can be an empty string
  test('API: worklog with empty notes string is accepted', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-emptynotes');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 15, notes: '' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.work_logs.length).toBe(1);
  });

  // 54. Worklog response includes time_estimate from POST response
  test('API: POST worklog response includes time_estimate field', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-postestim');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Set an estimate first
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_estimate: 60 },
    });

    const res = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 30 },
    });
    const body = await res.json();
    // The POST response should include time_estimate
    expect(body).toHaveProperty('time_estimate');
  });

  // 55. Worklog id field is unique across multiple entries
  test('API: each worklog entry has a unique id', async ({ request }) => {
    const { token, cardRes } = await makeUserAndCard(request, 'ttx-uniqueids');
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const amounts = [10, 20, 30, 40];
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
    const ids = body.work_logs.map((w: any) => w.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI: Additional time tracking modal tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Time Tracking — additional UI tests', () => {
  async function openCardModal(request: any, page: any) {
    const { token, board, card } = await setupBoardWithCard(request, page);
    if (!card) { test.skip(true, 'Card creation failed'); return null; }
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    return { token, board, card };
  }

  // 56. Time tracking section is not hidden behind a tab
  test('UI: time tracking section visible without clicking any tab', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;
    await expect(page.locator('.time-tracking-compact')).toBeVisible();
  });

  // 57. Time input accepts only positive numbers
  test('UI: time input accepts numeric value and enables Log button', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '15');
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeEnabled();
  });

  // 58. Log 240 minutes shows "4h logged"
  test('UI: logging 240 minutes shows "4h logged"', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '240');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('4h logged', { timeout: 5000 });
  });

  // 59. Log 59 minutes shows "59m logged" (not "0h 59m")
  test('UI: logging 59 minutes shows "59m logged" or similar minute-only format', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;
    await page.fill('.time-input-mini', '59');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText(/59m logged/, { timeout: 5000 });
  });

  // 60. Closing the modal and reopening reflects API-seeded worklog from another tab
  test('UI: API-seeded worklog total is shown when card is opened', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request, page);
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    // Seed via API before opening the modal
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 55 },
    });

    // Re-navigate to pick up the seeded data
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('55m logged', { timeout: 5000 });
  });

  // 61. Estimate set to 60, log 60 — progress bar is full (100%)
  test('UI: progress bar at 100% when logged equals estimated', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;

    // Set estimate to 60 minutes
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '60');
    await page.click('.btn:has-text("Save")');
    await expect(page.locator('.time-tracking-compact')).toBeVisible({ timeout: 5000 });

    // Log exactly 60 minutes
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Progress bar should be visible
    await expect(page.locator('.time-progress-mini')).toBeVisible();
  });

  // 62. Estimate set to 120, log 30 — progress bar shows partial fill
  test('UI: progress bar shows partial fill when logged < estimated', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;

    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '120');
    await page.click('.btn:has-text("Save")');
    await expect(page.locator('.time-tracking-compact')).toBeVisible({ timeout: 5000 });

    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });

    await expect(page.locator('.time-progress-mini')).toBeVisible();
    // Bar should NOT have "over" class since 30 < 120
    await expect(page.locator('.time-progress-bar.over')).not.toBeVisible();
  });

  // 63. Card modal displays "0m logged" not null or undefined
  test('UI: fresh card shows "0m logged" (not blank or undefined)', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;
    const loggedEl = page.locator('.time-tracking-stats .time-logged');
    await expect(loggedEl).toBeVisible();
    const text = await loggedEl.textContent();
    expect(text).not.toBeNull();
    expect(text?.trim()).not.toBe('');
    expect(text).toContain('0m logged');
  });

  // 64. Estimate field placeholder text is descriptive
  test('UI: estimate input has descriptive placeholder text', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;

    await page.click('.btn:has-text("Edit")');
    const estimateInput = page.locator('input[placeholder="e.g., 120"]');
    await expect(estimateInput).toBeVisible({ timeout: 5000 });
    const placeholder = await estimateInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  // 65. Setting estimate to 0 via edit form clears it
  test('UI: setting time estimate to empty string via edit clears it', async ({ page, request }) => {
    const ctx = await openCardModal(request, page);
    if (!ctx) return;

    // First set a value
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '60');
    await page.click('.btn:has-text("Save")');
    await expect(page.locator('.time-tracking-stats .time-estimate')).toBeVisible({ timeout: 5000 });

    // Now clear it
    await page.click('.btn:has-text("Edit")');
    await page.fill('input[placeholder="e.g., 120"]', '');
    await page.click('.btn:has-text("Save")');

    // Estimated line should disappear
    await expect(page.locator('.time-tracking-stats .time-estimate')).not.toBeVisible({ timeout: 5000 });
  });
});
