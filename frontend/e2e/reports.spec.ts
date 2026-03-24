import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  displayName = 'Reports Tester'
): Promise<string> {
  const email = `test-rpt-core-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  return (await res.json()).token as string;
}

async function createBoard(
  request: any,
  token: string,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()).id as number;
}

async function getFirstColumn(
  request: any,
  token: string,
  boardId: number
): Promise<number> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cols = await res.json();
  return cols[0].id as number;
}

async function createSwimlane(
  request: any,
  token: string,
  boardId: number
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Team', designator: 'TM', color: '#6366f1' },
  });
  return (await res.json()).id as number;
}

async function createAndCompleteSprint(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  sprintName = 'Sprint 1'
): Promise<number> {
  // Create sprint
  const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: sprintName },
  });
  const sprint = await sprintRes.json();

  // Create a card and assign it to the sprint
  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `${sprintName} Card`, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  const card = await cardRes.json();
  await request.put(`${BASE}/api/cards/${card.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { story_points: 5 },
  });
  await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprint.id },
  });

  // Start then complete the sprint
  await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return sprint.id as number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Reports — core', () => {
  // -------------------------------------------------------------------------
  // Page navigation & header
  // -------------------------------------------------------------------------

  test('navigates to /reports and shows page header', async ({ request, page }) => {
    const token = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.page-header h1')).toContainText('Reports');
  });

  // -------------------------------------------------------------------------
  // Board selector
  // -------------------------------------------------------------------------

  test('board selector dropdown is always present', async ({ request, page }) => {
    const token = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.reports-filters select').first()).toBeVisible();
  });

  test('board selector lists boards the user owns', async ({ request, page }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'My Visible Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Wait for boards to load — the loading spinner should disappear
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const selector = page.locator('.reports-filters select').first();
    await expect(selector.locator('option:has-text("My Visible Board")')).toBeAttached({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Empty state — no board selected
  // -------------------------------------------------------------------------

  test('shows "Select a board" empty state when user has no boards', async ({ request, page }) => {
    // Fresh user — no boards at all, so no board is auto-selected
    const token = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  // -------------------------------------------------------------------------
  // Empty state — board has no sprints
  // -------------------------------------------------------------------------

  test('shows "No sprints found" empty state when selected board has no sprints', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'Empty Sprint Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Auto-select or manually select the board
    const selector = page.locator('.reports-filters select').first();
    await selector.selectOption({ label: 'Empty Sprint Board' });

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');
    await expect(page.locator('.empty-state p')).toContainText('Create sprints');
  });

  // -------------------------------------------------------------------------
  // Sprint selector — only visible when board has sprints
  // -------------------------------------------------------------------------

  test('sprint selector is not rendered for a board with no sprints', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'No Sprint Selector Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Sprint Selector Board' });

    // Only one select should be present — no sprint selector
    await expect(page.locator('.reports-filters select')).toHaveCount(1, { timeout: 5000 });
  });

  test('sprint selector appears after creating a sprint on the board', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Selector Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint A');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selector Board' });

    // Second select (sprint picker) should appear
    await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Metrics summary
  // -------------------------------------------------------------------------

  test('metrics summary is visible when a board has sprints', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metrics Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metrics Board' });

    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
  });

  test('metrics summary has Sprint Completion, Avg Velocity, and Completed Sprints cards', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metric Cards Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metric Cards Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.metric-card').filter({ has: page.locator('.metric-label:has-text("Sprint Completion")') })).toBeVisible();
    await expect(page.locator('.metric-card').filter({ has: page.locator('.metric-label:has-text("Avg Velocity")') })).toBeVisible();
    await expect(page.locator('.metric-card').filter({ has: page.locator('.metric-label:has-text("Completed Sprints")') })).toBeVisible();
  });

  test('Completed Sprints metric reflects actual completed sprint count', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Completed Count Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint Done');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Completed Count Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const completedCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Completed Sprints")'),
    });
    const value = await completedCard.locator('.metric-value').textContent();
    expect(parseInt(value || '0')).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Chart sections
  // -------------------------------------------------------------------------

  test('Sprint Burndown, Velocity Trend, and Cumulative Flow chart cards are rendered', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Charts Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Charts Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible();
    await expect(page.locator('.chart-card h3:has-text("Velocity Trend")')).toBeVisible();
    await expect(page.locator('.chart-card h3:has-text("Cumulative Flow")')).toBeVisible();
  });

  test('Velocity Trend chart renders recharts bars for a board with completed sprints', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Render Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint V1');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Render Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible();
    // Recharts renders SVG bars; at least one recharts-bar group should exist
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('Sprint Burndown shows empty state text when sprint has no metric data', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'No Burndown Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    // Create a sprint but do NOT start or complete it — it will have no burndown metrics
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Planning Sprint' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Burndown Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Sprint Burndown")'),
    });
    await expect(burndownCard.locator('.chart-empty')).toBeVisible({ timeout: 8000 });
    await expect(burndownCard.locator('.chart-empty p')).toContainText('No data available for this sprint');
  });

  test('Velocity Trend shows empty state text when no completed sprints exist', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'No Velocity Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    // Only a planning sprint — no velocity data
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Planning Only' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard.locator('.chart-empty p')).toContainText('Complete sprints to see velocity data', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Time tracking section
  // -------------------------------------------------------------------------

  test('time tracking section appears when a board with sprints is selected', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Time Tracking Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint TT');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Time Tracking Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Time tracking section loads once the timeSummary API call resolves
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });
  });

  test('time tracking section contains "Time Tracking" heading and sub-charts', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'TT Section Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint TT2');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'TT Section Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.time-tracking-section h2')).toContainText('Time Tracking');
    await expect(page.locator('.time-tracking-section .chart-card h3:has-text("Total Time: Logged vs Estimated")')).toBeVisible();
    await expect(page.locator('.time-tracking-section .chart-card h3:has-text("Time Logged by Team Member")')).toBeVisible();
  });

  test('time tracking section shows "No time logged yet" when no work logs exist', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'No Logs Board');
    const columnId = await getFirstColumn(request, token, boardId);
    const swimlaneId = await createSwimlane(request, token, boardId);

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint NL');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Logs Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    const byUserCard = page.locator('.time-tracking-section .chart-card').filter({
      has: page.locator('h3:has-text("Time Logged by Team Member")'),
    });
    await expect(byUserCard.locator('.chart-empty p')).toContainText('No time logged yet', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Switching boards
  // -------------------------------------------------------------------------

  test('switching board selector updates the page content', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);

    // Board A: has a completed sprint
    const boardAId = await createBoard(request, token, 'Board Switch A');
    const colA = await getFirstColumn(request, token, boardAId);
    const swA = await createSwimlane(request, token, boardAId);
    await createAndCompleteSprint(request, token, boardAId, colA, swA, 'Sprint A');

    // Board B: no sprints
    await createBoard(request, token, 'Board Switch B');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Select Board A — should show metrics
    await page.locator('.reports-filters select').first().selectOption({ label: 'Board Switch A' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Switch to Board B — should show "No sprints found"
    await page.locator('.reports-filters select').first().selectOption({ label: 'Board Switch B' });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');

    // Switch back to Board A — metrics should reappear
    await page.locator('.reports-filters select').first().selectOption({ label: 'Board Switch A' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Unimplemented / future features
  // -------------------------------------------------------------------------

  test.fixme('date range filter narrows burndown data to selected range', async ({ page }) => {
    // Date range filter inputs are not yet implemented in Reports.tsx
  });

  test.fixme('print / export button opens browser print dialog or triggers download', async ({ page }) => {
    // No print/export button exists in the current Reports page implementation
  });

  test.fixme('export burndown data to CSV', async ({ page }) => {
    // CSV export is not yet implemented for the reports page
  });

  test.fixme('board member filter scopes time tracking data to selected member', async ({ page }) => {
    // Per-member filter UI is not yet implemented in Reports.tsx
  });
});
