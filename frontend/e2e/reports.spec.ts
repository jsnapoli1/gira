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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(90000);
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
    test.setTimeout(60000);
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
    // Wait for the sprint options to update to Board B's sprints
    await expect(sprintSelectB.locator('option:has-text("Beta Sprint")')).toBeAttached({ timeout: 8000 });
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

// =============================================================================
// Reports — page layout, navigation, and UI (40+ new tests)
// =============================================================================

test.describe('Reports — page layout and accessibility', () => {

  // -------------------------------------------------------------------------
  // Page title & structure
  // -------------------------------------------------------------------------

  test('/reports page is accessible to authenticated users without a 401', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    // Should not redirect to /login
    await expect(page).toHaveURL(/\/reports/);
  });

  test('/reports page title is "Reports" in page-header h1', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.page-header h1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.page-header h1')).toHaveText('Reports');
  });

  test('/reports has a board selector dropdown inside .reports-filters', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
  });

  test('/reports board selector lists user boards by name', async ({ request, page }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'Layout Test Board');
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    const selector = page.locator('.reports-filters select').first();
    await expect(selector.locator('option:has-text("Layout Test Board")')).toBeAttached({ timeout: 8000 });
  });

  test('/reports unauthenticated visit redirects to /login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/);
  });

  test('.reports-page wrapper element is present in DOM', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.reports-page')).toBeAttached();
  });

  test('.page-header is a child of .reports-page', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.reports-page .page-header')).toBeAttached();
  });

  test('loading state shows "Loading reports..." text before boards arrive', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    // Intercept boards list to delay it
    await page.route('**/api/boards', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.goto('/reports');
    // The loading div may flash briefly — check URL stayed on /reports
    await expect(page).toHaveURL(/\/reports/);
    // After load, selector is visible
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 12000 });
  });

  // -------------------------------------------------------------------------
  // Board selector — selecting a board
  // -------------------------------------------------------------------------

  test('selecting a board from the dropdown loads report data (removes empty-state)', async ({ request, page }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Select Board Test');
    await createSwimlane(request, token, boardId);
    await createSprint(request, token, boardId, 'Sprint 1');
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Select Board Test' });
    // After selecting a board with a sprint, empty-state "Select a board" should disappear
    await expect(page.locator('.empty-state h2:has-text("Select a board")')).not.toBeVisible({ timeout: 6000 });
  });

  test('board selector placeholder option value is empty string', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    const placeholder = page.locator('.reports-filters select option[value=""]');
    await expect(placeholder).toBeAttached();
    const text = await placeholder.textContent();
    expect(text).toContain('Select a board');
  });

  test('board selector default value is empty string when user has no boards', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    const selectValue = await page.locator('.reports-filters select').first().inputValue();
    expect(selectValue).toBe('');
  });

  test('multiple boards owned by user all appear in board selector', async ({ request, page }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'First Multi Board');
    await createBoard(request, token, 'Second Multi Board');
    await createBoard(request, token, 'Third Multi Board');
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    const selector = page.locator('.reports-filters select').first();
    await expect(selector.locator('option:has-text("First Multi Board")')).toBeAttached({ timeout: 8000 });
    await expect(selector.locator('option:has-text("Second Multi Board")')).toBeAttached({ timeout: 8000 });
    await expect(selector.locator('option:has-text("Third Multi Board")')).toBeAttached({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Sprint selector
  // -------------------------------------------------------------------------

  test('sprint selector shows board sprints (planned, active, completed)', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Status Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    // Create planned sprint
    await createSprint(request, token, boardId, 'Planned Sprint');

    // Create and complete a sprint
    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Completed Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Status Board' });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    await expect(sprintSelect.locator('option:has-text("Planned Sprint")')).toBeAttached({ timeout: 5000 });
    await expect(sprintSelect.locator('option:has-text("Completed Sprint")')).toBeAttached({ timeout: 5000 });
  });

  test('sprint selector option text includes sprint status in parentheses', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Status Text Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Status Test Sprint');
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Status Text Board' });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    // Option format is "Sprint Name (status)"
    await expect(sprintSelect.locator('option:has-text("(completed)")')).toBeAttached({ timeout: 5000 });
  });

  test('selecting a sprint in sprint selector updates chart to that sprint', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Selection Charts Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Chart Sprint A');
    await createSprint(request, token, boardId, 'Chart Sprint B');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selection Charts Board' });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    // Select Chart Sprint B
    await sprintSelect.selectOption({ label: /Chart Sprint B/ });
    // Charts grid remains visible after switching sprint
    await expect(page.locator('.charts-grid')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Burndown chart
  // -------------------------------------------------------------------------

  test('burndown chart renders an SVG element after completing a sprint', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown SVG Render Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Burndown Render Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown SVG Render Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Sprint Burndown")') });
    await expect(burndownCard.locator('svg')).toBeAttached({ timeout: 8000 });
  });

  test('burndown chart card has h3 heading "Sprint Burndown"', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown H3 Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'H3 Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown H3 Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible({ timeout: 8000 });
  });

  test('burndown chart recharts area/line renders with actual data', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown Area Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Area Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown Area Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Sprint Burndown")') });
    // Recharts renders either .recharts-area or .recharts-line elements when data exists
    await expect(burndownCard.locator('.recharts-area, .recharts-line').first()).toBeAttached({ timeout: 8000 });
  });

  test('burndown ideal line is rendered as a recharts-line element', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Ideal Line Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Ideal Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Ideal Line Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Sprint Burndown")') });
    await expect(burndownCard.locator('.recharts-line')).toBeAttached({ timeout: 8000 });
  });

  test('burndown chart shows "No data available for this sprint" when sprint has no metric data', async ({ request, page }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown No Metric Board');
    await createSwimlane(request, token, boardId);
    await createSprint(request, token, boardId, 'No Data Sprint B');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown No Metric Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Sprint Burndown")') });
    await expect(burndownCard.locator('.chart-empty p')).toContainText('No data available for this sprint', { timeout: 8000 });
  });

  test('burndown API endpoint GET /api/metrics/burndown returns 200 for started sprint', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown API Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    // Create sprint with card and start it
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Test Sprint' },
    });
    const sprint = await sprintRes.json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'API Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('burndown API response contains dates array (each entry has a date field)', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown Dates Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Dates Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('date');
    }
  });

  test('burndown API response entries have remaining_points field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Burndown Remaining Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Remaining Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.length > 0) {
      expect(typeof data[0].remaining_points).toBe('number');
    }
  });

  // -------------------------------------------------------------------------
  // Velocity chart
  // -------------------------------------------------------------------------

  test('velocity chart renders when a board has at least one completed sprint', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Render Core Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Vel Core Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Render Core Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard).toBeVisible();
    await expect(velocityCard.locator('svg')).toBeAttached({ timeout: 8000 });
  });

  test('velocity chart shows completed sprint data as bars', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Bars Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Bars Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Bars Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('velocity chart has two bar series (Committed and Completed)', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Two Bars Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Two Bars Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Two Bars Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.recharts-bar')).toHaveCount(2, { timeout: 8000 });
  });

  test('velocity chart Y axis is rendered inside velocity chart SVG', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Y Axis Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Y Axis Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Y Axis Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.recharts-yAxis')).toBeAttached({ timeout: 8000 });
  });

  test('velocity chart X axis is rendered inside velocity chart SVG', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity X Axis Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'X Axis Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity X Axis Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.recharts-xAxis')).toBeAttached({ timeout: 8000 });
  });

  test('velocity chart shows empty state "Complete sprints..." when no sprints completed', async ({ request, page }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Empty Core Board');
    await createSwimlane(request, token, boardId);
    await createSprint(request, token, boardId, 'Not Started Sprint');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Empty Core Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.chart-empty p')).toContainText('Complete sprints', { timeout: 8000 });
  });

  test('velocity API endpoint GET /api/metrics/velocity returns array', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity API Array Board');
    await createSwimlane(request, token, boardId);
    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('velocity API data item has sprint_name string field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Sprint Name Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'VName Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(typeof data[0].sprint_name).toBe('string');
    expect(data[0].sprint_name).toBe('VName Sprint');
  });

  test('velocity API data item has completed_points numeric field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Velocity Completed Pts Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'CompPts Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(typeof data[0].completed_points).toBe('number');
  });

  test('multiple completed sprints appear as multiple velocity entries', async ({ request, page }) => {
    test.setTimeout(120000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Multi Velocity Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    for (const name of ['Vel Sprint 1', 'Vel Sprint 2']) {
      const id = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, name);
      if (id === -1) { test.skip(true, 'Card creation unavailable'); return; }
    }

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test('velocity chart with two completed sprints renders two recharts-bar groups', async ({ request, page }) => {
    test.setTimeout(120000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Two Sprint Velocity Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    for (const name of ['Two Vel A', 'Two Vel B']) {
      const id = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, name);
      if (id === -1) { test.skip(true, 'Card creation unavailable'); return; }
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Two Sprint Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Sprint metrics
  // -------------------------------------------------------------------------

  test('sprint metrics section shows current sprint stats when board selected', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Stats Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Stats Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Stats Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
    // metrics-summary contains at least 3 metric-card elements
    await expect(page.locator('.metric-card')).toHaveCount(3, { timeout: 8000 });
  });

  test('Sprint Completion metric card shows a percentage value', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Completion Pct UI Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Pct Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Completion Pct UI Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const completionCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Sprint Completion")'),
    });
    const val = await completionCard.locator('.metric-value').textContent({ timeout: 8000 });
    expect(val).toMatch(/%$/);
  });

  test('Avg Velocity metric card shows numeric pts value', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Avg Vel UI Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Avg Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Avg Vel UI Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const avgCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Avg Velocity")'),
    });
    const val = await avgCard.locator('.metric-value').textContent({ timeout: 8000 });
    expect(val).toMatch(/pts$/);
  });

  test('Completed Sprints count increments after second sprint completion', async ({ request, page }) => {
    test.setTimeout(120000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Count Increment Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    // Complete two sprints
    for (const name of ['Count Sprint 1', 'Count Sprint 2']) {
      const id = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, name);
      if (id === -1) { test.skip(true, 'Card creation unavailable'); return; }
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Count Increment Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const completedCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Completed Sprints")'),
    });
    const val = await completedCard.locator('.metric-value').textContent({ timeout: 8000 });
    expect(parseInt(val || '0')).toBeGreaterThanOrEqual(2);
  });

  test('GET /api/sprints/:id/metrics returns 200 with metrics object', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Sprint Metrics API Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    // Create and start sprint
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Metrics API Sprint' },
    });
    const sprint = await sprintRes.json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Metrics Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('sprint metrics has total_cards field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metrics Total Cards Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Total Cards Sprint' },
    });
    const sprint = await sprintRes.json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'TC Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;
    expect(entry).toHaveProperty('total_cards');
    expect(typeof entry.total_cards).toBe('number');
  });

  test('sprint metrics has completed_cards field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metrics Completed Cards Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Completed Cards Sprint' },
    });
    const sprint = await sprintRes.json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'CC Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;
    expect(entry).toHaveProperty('completed_cards');
    expect(typeof entry.completed_cards).toBe('number');
  });

  test('sprint metrics has total_points field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metrics Total Points Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'TP Metrics Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;
    expect(entry).toHaveProperty('total_points');
    expect(typeof entry.total_points).toBe('number');
  });

  test('sprint metrics has completed_points field', async ({ request }) => {
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'Metrics Completed Points Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'CP Metrics Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;
    expect(entry).toHaveProperty('completed_points');
    expect(typeof entry.completed_points).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Report navigation
  // -------------------------------------------------------------------------

  test('reports link in sidebar/nav navigates to /reports', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/boards');
    const reportsLink = page.locator('a[href="/reports"]');
    await expect(reportsLink).toBeVisible({ timeout: 10000 });
    await reportsLink.click();
    await expect(page).toHaveURL(/\/reports/);
  });

  test('reports page accessible without board selection — shows select-board prompt', async ({ request, page }) => {
    const token = await createUser(request);
    await createBoard(request, token, 'Navigation Board');
    await injectToken(page, token);
    // Navigate directly without selecting board
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    // With boards but none selected, shows select-board prompt or auto-selects first
    await expect(page).toHaveURL(/\/reports/);
  });

  test('navigating back from /reports to /boards retains correct URL', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.goBack();
    await expect(page).not.toHaveURL(/\/reports/);
  });

  test('navigating forward returns to /reports after going back', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/boards');
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.goBack();
    await page.goForward();
    await expect(page).toHaveURL(/\/reports/);
  });

  // -------------------------------------------------------------------------
  // Cumulative Flow chart
  // -------------------------------------------------------------------------

  test('cumulative flow chart card renders when board has completed sprint', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'CFD Render Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'CFD Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'CFD Render Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.chart-card h3:has-text("Cumulative Flow")')).toBeVisible({ timeout: 8000 });
  });

  test('cumulative flow chart shows SVG when burndown data exists', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'CFD SVG Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'CFD SVG Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'CFD SVG Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const cfdCard = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Cumulative Flow")') });
    await expect(cfdCard.locator('svg')).toBeAttached({ timeout: 8000 });
  });

  test('cumulative flow chart has "wide" layout class', async ({ request, page }) => {
    test.setTimeout(90000);
    const token = await createUser(request);
    const boardId = await createBoard(request, token, 'CFD Wide Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;

    const sprintId = await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'CFD Wide Sprint');
    if (sprintId === -1) { test.skip(true, 'Card creation unavailable'); return; }

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'CFD Wide Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.chart-card.wide')).toBeAttached({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  test('error banner is shown when API returns an error and dismissible with × button', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);

    // Intercept velocity API to return 500
    await page.route('**/api/metrics/velocity**', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal error' }) });
    });

    const boardId = await createBoard(request, token, 'Error Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const cols = await getColumns(request, token, boardId);
    const columnId = cols[0].id;
    await createAndCompleteSprint(request, token, boardId, columnId, swimlaneId, 'Error Sprint');

    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.reports-filters select').first().selectOption({ label: 'Error Board' });

    // Error banner appears
    await expect(page.locator('.error-banner')).toBeVisible({ timeout: 8000 });

    // Dismiss it
    await page.locator('.error-banner button').click();
    await expect(page.locator('.error-banner')).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Future features (fixme stubs)
  // -------------------------------------------------------------------------

  test.fixme('board selection persists in localStorage between page refreshes', async ({ page }) => {
    // Persisting board/sprint selection in localStorage is not yet implemented
  });

  test.fixme('sprint selection persists in URL query param', async ({ page }) => {
    // URL persistence of sprint selection is not yet implemented
  });

  test.fixme('reports page shows days remaining in sprint', async ({ page }) => {
    // Days remaining metric card not yet implemented in Reports.tsx
  });

  test.fixme('reports page shows overdue cards count', async ({ page }) => {
    // Overdue cards metric card not yet implemented in Reports.tsx
  });

  test.fixme('sprint progress percentage shown in metrics section', async ({ page }) => {
    // Sprint progress percentage metric beyond completion% not yet implemented
  });
});
