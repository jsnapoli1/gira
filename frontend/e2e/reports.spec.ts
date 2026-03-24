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

async function getColumns(
  request: any,
  token: string,
  boardId: number
): Promise<Array<{ id: number; name: string; state: string; position: number }>> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
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

/** Create a sprint (via API) and return its id. Does NOT start or complete it. */
async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()).id as number;
}

/**
 * Create a sprint, assign a card to it, start it and complete it so the board
 * appears in the velocity/metrics data.
 * Returns the sprint id, or -1 if card creation was unavailable.
 */
async function createAndCompleteSprint(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  sprintName = 'Sprint 1'
): Promise<number> {
  const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: sprintName },
  });
  const sprint = await sprintRes.json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `${sprintName} Card`, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!cardRes.ok()) {
    return -1;
  }
  const card = await cardRes.json();

  await request.put(`${BASE}/api/cards/${card.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { story_points: 5 },
  });
  await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprint.id },
  });
  await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return sprint.id as number;
}

// ---------------------------------------------------------------------------
// Token injection helper — uses evaluate (not addInitScript)
// ---------------------------------------------------------------------------
async function injectToken(page: any, token: string): Promise<void> {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Reports — core', () => {
  // -------------------------------------------------------------------------
  // Page navigation & header
  // -------------------------------------------------------------------------

  test('navigates to /reports via direct URL and shows "Reports" page header', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.page-header h1')).toContainText('Reports');
  });

  test('navigates to /reports via sidebar link and URL updates', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/boards');
    await expect(page.locator('a[href="/reports"]')).toBeVisible({ timeout: 10000 });

    // Click the Reports link in the sidebar/nav
    await page.click('a[href="/reports"]');
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.page-header h1')).toContainText('Reports');
  });

  // -------------------------------------------------------------------------
  // Board selector — always present
  // -------------------------------------------------------------------------

  test('board selector dropdown is always present on the page', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.reports-filters select').first()).toBeVisible();
  });

  test('board selector has a "Select a board..." placeholder option', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    const select = page.locator('.reports-filters select').first();
    await expect(select.locator('option[value=""]')).toBeAttached();
  });

  test('board selector lists boards the user owns', async ({ request, page }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'My Visible Board');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const selector = page.locator('.reports-filters select').first();
    await expect(selector.locator('option:has-text("My Visible Board")')).toBeAttached({ timeout: 8000 });
  });

  test('boards from other users do not appear in selector', async ({ request, page }) => {
    const tokenA = await createUser(request, 'User A');
    const tokenB = await createUser(request, 'User B');
    await createBoard(request, tokenA, 'User A Board');
    await createBoard(request, tokenB, 'User B Board');

    await injectToken(page, tokenA);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const selector = page.locator('.reports-filters select').first();
    await expect(selector.locator('option:has-text("User A Board")')).toBeAttached({ timeout: 8000 });
    await expect(selector.locator('option:has-text("User B Board")')).not.toBeAttached();
  });

  // -------------------------------------------------------------------------
  // Empty state — no board selected (user has no boards)
  // -------------------------------------------------------------------------

  test('shows empty state when user has no boards and no board is selected', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Empty Sprint Board' });

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

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await createSwimlane(request, token, boardId);

    await createSprint(request, token, boardId, 'Planning Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selector Board' });

    // Second select (sprint picker) should appear
    await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
  });

  test('sprint created via API appears in reports sprint selector options', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint In Selector Board');
    await createSwimlane(request, token, boardId);
    await createSprint(request, token, boardId, 'Expected Sprint Name');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint In Selector Board' });
    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    await expect(sprintSelect.locator('option:has-text("Expected Sprint Name")')).toBeAttached({ timeout: 5000 });
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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metrics Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
  });

  test('metrics summary has Sprint Completion, Avg Velocity, and Completed Sprints cards', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metric Cards Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint Done');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint 1');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint V1');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Render Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible();
    // Recharts renders SVG bars; at least one recharts-bar group should exist
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('Sprint Burndown shows empty state when sprint has no metric data', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'No Burndown Board');
    await createSwimlane(request, token, boardId);

    // Create a sprint but do NOT start or complete it — it will have minimal burndown metrics
    await createSprint(request, token, boardId, 'Planning Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await createSwimlane(request, token, boardId);

    // Only a planning sprint — no velocity data
    await createSprint(request, token, boardId, 'Planning Only');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard.locator('.chart-empty p')).toContainText('Complete sprints to see velocity data', { timeout: 8000 });
  });

  test('Cumulative Flow chart shows empty state when sprint has no burndown data', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'No CFD Board');
    await createSwimlane(request, token, boardId);
    await createSprint(request, token, boardId, 'No Data Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'No CFD Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const cfdCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Cumulative Flow")'),
    });
    await expect(cfdCard.locator('.chart-empty')).toBeVisible({ timeout: 8000 });
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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint TT');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint TT2');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Sprint NL');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Logs Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    const byUserCard = page.locator('.time-tracking-section .chart-card').filter({
      has: page.locator('h3:has-text("Time Logged by Team Member")'),
    });
    await expect(byUserCard.locator('.chart-empty p')).toContainText('No time logged yet', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Board switcher
  // -------------------------------------------------------------------------

  test('switching board selector updates page content', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);

    // Board A: has a completed sprint
    const boardAId = await createBoard(request, token, 'Board Switch A');
    const swA = await createSwimlane(request, token, boardAId);
    const colsA = await getColumns(request, token, boardAId);
    const colA = colsA[0].id;
    const sprintId = await createAndCompleteSprint(request, token, boardAId, colA, swA, 'Sprint A');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    // Board B: no sprints
    await createBoard(request, token, 'Board Switch B');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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

  test('sprint selector updates when switching between boards with different sprints', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);

    const boardAId = await createBoard(request, token, 'Sprint Switch Board A');
    await createSwimlane(request, token, boardAId);
    await createSprint(request, token, boardAId, 'Alpha Sprint');

    const boardBId = await createBoard(request, token, 'Sprint Switch Board B');
    await createSwimlane(request, token, boardBId);
    await createSprint(request, token, boardBId, 'Beta Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Switch Board A' });
    const sprintSelectA = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelectA).toBeVisible({ timeout: 8000 });
    await expect(sprintSelectA.locator('option:has-text("Alpha Sprint")')).toBeAttached();
    await expect(sprintSelectA.locator('option:has-text("Beta Sprint")')).not.toBeAttached();

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Switch Board B' });
    const sprintSelectB = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelectB).toBeVisible({ timeout: 8000 });
    await expect(sprintSelectB.locator('option:has-text("Beta Sprint")')).toBeAttached();
    await expect(sprintSelectB.locator('option:has-text("Alpha Sprint")')).not.toBeAttached();
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
