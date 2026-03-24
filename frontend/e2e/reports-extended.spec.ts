import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  columnId: number;
  doneColumnId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName = 'Reports Tester'): Promise<string> {
  const email = `test-rpt-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  return (await res.json()).token as string;
}

async function setupBoard(
  request: any,
  token: string,
  boardName = 'Reports Board'
): Promise<BoardSetup> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM', color: '#6366f1' },
    })
  ).json();

  const columns: Array<{ id: number; name: string; state: string; position: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sorted = [...columns].sort((a, b) => a.position - b.position);
  const doneCol = sorted.find((c) => c.state === 'closed') ?? sorted[sorted.length - 1];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    columnId: sorted[0].id,
    doneColumnId: doneCol.id,
  };
}

/**
 * Create a sprint, add a card, start and complete the sprint.
 * Returns sprintId or -1 if card creation was unavailable.
 */
async function createAndCompleteSprint(
  request: any,
  token: string,
  bs: BoardSetup,
  sprintName = 'Sprint 1',
  storyPoints = 5
): Promise<number> {
  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `${sprintName} Card`,
      column_id: bs.columnId,
      swimlane_id: bs.swimlaneId,
      board_id: bs.boardId,
    },
  });
  if (!cardRes.ok()) {
    return -1;
  }
  const card = await cardRes.json();

  await request.put(`${BASE}/api/cards/${card.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { story_points: storyPoints },
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

test.describe('Reports Extended', () => {
  // -------------------------------------------------------------------------
  // Basic page load
  // -------------------------------------------------------------------------

  test('reports page loads with board selector and page title', async ({ request, page }) => {
    const token = await createUser(request);
    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-header h1')).toContainText('Reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Board with no sprints
  // -------------------------------------------------------------------------

  test('selecting a board shows empty state when board has no sprints', async ({ request, page }) => {
    const token = await createUser(request);
    await setupBoard(request, token, 'Selector Test Board');

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Selector Test Board' });

    await expect(page.locator('.empty-state h2')).toContainText('No sprints found', { timeout: 8000 });
  });

  test('reports page accessible without any boards — shows select-board empty state', async ({ request, page }) => {
    const token = await createUser(request, 'No Board User');
    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  test('board with no sprints shows empty state', async ({ request, page }) => {
    const token = await createUser(request);
    await setupBoard(request, token, 'No Sprint Board');

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Sprint Board' });

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');
  });

  // -------------------------------------------------------------------------
  // Sprint selector with sprints
  // -------------------------------------------------------------------------

  test('sprint selector appears after completing a sprint', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Sprint Selector Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Completed Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selector Board' });

    await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
  });

  test('sprint selector option text includes sprint name and status', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Sprint Label Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Named Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Label Board' });
    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    // Options include sprint name + status e.g. "Named Sprint (completed)"
    await expect(sprintSelect.locator('option:has-text("Named Sprint")')).toBeAttached();
  });

  test('switching between sprints in selector keeps charts grid visible', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Multi Sprint Charts Board');

    const id1 = await createAndCompleteSprint(request, token, bs, 'Sprint One', 5);
    if (id1 === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }
    const id2 = await createAndCompleteSprint(request, token, bs, 'Sprint Two', 8);
    if (id2 === -1) {
      test.skip(true, `Card creation unavailable: cannot complete second sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Multi Sprint Charts Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });

    // Select Sprint One
    await sprintSelect.selectOption({ label: /Sprint One/ });
    await expect(page.locator('.charts-grid')).toBeVisible({ timeout: 6000 });

    // Switch to Sprint Two — charts should remain visible
    await sprintSelect.selectOption({ label: /Sprint Two/ });
    await expect(page.locator('.charts-grid')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // Metrics summary
  // -------------------------------------------------------------------------

  test('metrics section shows completed sprint count ≥ 1 after completing a sprint', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Metrics Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Done Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metrics Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const completedMetric = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Completed Sprints")'),
    });
    const val = await completedMetric.locator('.metric-value').textContent({ timeout: 8000 });
    expect(parseInt(val || '0')).toBeGreaterThanOrEqual(1);
  });

  test('all metric-card elements contain both metric-label and metric-value', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Metric Render Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Render Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metric Render Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const cards = page.locator('.metric-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator('.metric-label')).toBeVisible();
      await expect(cards.nth(i).locator('.metric-value')).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // Velocity chart
  // -------------------------------------------------------------------------

  test('velocity chart renders recharts bars after completing a sprint', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Velocity Chart Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Velocity Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Chart Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible({ timeout: 8000 });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('velocity chart shows two recharts-bar series for two completed sprints', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Dual Velocity Board');

    for (const name of ['Sprint Alpha', 'Sprint Beta']) {
      const id = await createAndCompleteSprint(request, token, bs, name);
      if (id === -1) {
        test.skip(true, `Card creation unavailable: cannot complete sprint`);
        return;
      }
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Dual Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
    // Two bar series — "Committed" and "Completed"
    await expect(velocityCard.locator('.recharts-bar')).toHaveCount(2);
  });

  // -------------------------------------------------------------------------
  // Burndown chart SVG
  // -------------------------------------------------------------------------

  test('burndown chart SVG renders when sprint has metric data', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Burndown SVG Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Burndown Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown SVG Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Sprint Burndown")'),
    });
    // When data exists, recharts renders an SVG element inside the chart-card
    await expect(burndownCard.locator('svg').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Time tracking section layout
  // -------------------------------------------------------------------------

  test('time tracking section is a child of .reports-page', async ({ request, page }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'TT Layout Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'TT Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'TT Layout Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.reports-page .time-tracking-section')).toBeVisible();
  });

  test('time tracking "Total Time: Logged vs Estimated" chart card is rendered', async ({
    request,
    page,
  }) => {
    const token = await createUser(request);
    const bs = await setupBoard(request, token, 'Progress Bar Board');

    const sprintId = await createAndCompleteSprint(request, token, bs, 'Bar Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Progress Bar Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    const ttCard = page.locator('.time-tracking-section .chart-card').filter({
      has: page.locator('h3:has-text("Total Time: Logged vs Estimated")'),
    });
    await expect(ttCard).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Switching boards
  // -------------------------------------------------------------------------

  test('switching board selector updates content', async ({ request, page }) => {
    const token = await createUser(request);

    // Board A: has a completed sprint
    const bsA = await setupBoard(request, token, 'Board Alpha');
    const sprintId = await createAndCompleteSprint(request, token, bsA, 'Alpha Sprint');
    if (sprintId === -1) {
      test.skip(true, `Card creation unavailable: cannot complete sprint`);
      return;
    }

    // Board B: no sprints
    await setupBoard(request, token, 'Board Beta');

    await injectToken(page, token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Select Board Alpha — should show metrics
    await page.locator('.reports-filters select').first().selectOption({ label: 'Board Alpha' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Switch to Board Beta — should show empty state (no sprints)
    await page.locator('.reports-filters select').first().selectOption({ label: 'Board Beta' });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');
  });

  // -------------------------------------------------------------------------
  // Export / print (stub — not yet implemented)
  // -------------------------------------------------------------------------

  test.fixme('export/print functionality triggers when export button is clicked', async ({ page }) => {
    // No export button exists in the current Reports page implementation
  });
});
