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
