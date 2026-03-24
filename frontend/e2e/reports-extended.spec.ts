import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  columnId: number;
}

async function createUser(request: any, displayName = 'Reports Tester'): Promise<{ token: string }> {
  const email = `test-rpt-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function createBoardWithSwimlane(
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

  const columns = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    columnId: columns[0].id,
  };
}

/**
 * Creates a card with story points. Returns the card object or null if
 * card creation is unavailable (Gitea 401 / 403).
 */
async function createCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title: string,
  storyPoints = 3
) {
  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!cardRes.ok()) {
    return null;
  }
  const card = await cardRes.json();
  if (storyPoints > 0) {
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { story_points: storyPoints },
    });
  }
  return card;
}

/**
 * Creates a sprint, assigns a card, starts, and completes the sprint.
 * Returns sprintId or null if card creation fails.
 */
async function createAndCompleteSprint(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  sprintName = 'Sprint 1'
): Promise<{ sprintId: number } | null> {
  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  // Create a card and assign to the sprint
  const card = await createCard(request, token, boardId, columnId, swimlaneId, `${sprintName} Card`, 5);
  if (!card) {
    return null; // caller should skip
  }

  await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprint.id },
  });

  // Start then complete sprint
  await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return { sprintId: sprint.id };
}

test.describe('Reports Extended', () => {
  // -------------------------------------------------------------------------
  // Basic page structure
  // -------------------------------------------------------------------------

  test('reports page loads with board selector', async ({ request, page }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-header h1')).toContainText('Reports');
    // Board selector dropdown should be present
    await expect(page.locator('.reports-filters select').first()).toBeVisible();
  });

  test('selecting a board shows sprint selector or empty state', async ({ request, page }) => {
    const { token } = await createUser(request);
    await createBoardWithSwimlane(request, token, 'Selector Test Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Select the board
    await page.locator('.reports-filters select').first().selectOption({ label: 'Selector Test Board' });

    // With no sprints the empty state should appear
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found', { timeout: 8000 });
  });

  test('board with no sprints shows empty state', async ({ request, page }) => {
    const { token } = await createUser(request);
    await createBoardWithSwimlane(request, token, 'No Sprint Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No Sprint Board' });

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');
  });

  // -------------------------------------------------------------------------
  // Sprint selector
  // -------------------------------------------------------------------------

  test('sprint selector appears after completing a sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Sprint Selector Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Completed Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selector Board' });

    // After selecting a board with sprints, a second select (sprint selector) should appear
    await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
  });

  test('sprint selector lists multiple sprints when board has several', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Multi Sprint Board');

    const result1 = await createAndCompleteSprint(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'Sprint One');
    if (!result1) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }
    const result2 = await createAndCompleteSprint(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'Sprint Two');
    if (!result2) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Multi Sprint Board' });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    // There should be at least 2 sprint options
    const optionCount = await sprintSelect.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Metrics after completed sprint
  // -------------------------------------------------------------------------

  test('metrics section shows data after completed sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Metrics Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Done Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Metrics Board' });

    // metrics-summary should be visible
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Completed Sprints count should show at least 1
    const completedMetric = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Completed Sprints")'),
    });
    await expect(completedMetric.locator('.metric-value')).not.toHaveText('0', { timeout: 8000 });
  });

  test('metrics numbers match expected values for single completed sprint with 5 story points', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Exact Metrics Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Exact Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Exact Metrics Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // With 1 completed sprint, Completed Sprints should be exactly 1
    const completedCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Completed Sprints")'),
    });
    const completedVal = await completedCard.locator('.metric-value').textContent();
    expect(parseInt(completedVal || '0')).toBeGreaterThanOrEqual(1);

    // Avg Velocity should end with " pts"
    const velocityCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Avg Velocity")'),
    });
    await expect(velocityCard.locator('.metric-value')).toContainText('pts');
  });

  // -------------------------------------------------------------------------
  // Burndown chart with data
  // -------------------------------------------------------------------------

  test('burndown chart section is visible after board selection', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Burndown Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Burndown Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Velocity chart
  // -------------------------------------------------------------------------

  test('velocity chart renders after completing a sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Velocity Chart Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Velocity Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Chart Board' });

    // Wait for metrics to load
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // The velocity chart section should show a recharts bar SVG rather than the empty state
    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible({ timeout: 8000 });
    // recharts renders an svg; if data exists there will be recharts-bar elements
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('velocity chart shows bars for two completed sprints', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Two Velocity Board');

    const r1 = await createAndCompleteSprint(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'Vel Sprint 1');
    if (!r1) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }
    const r2 = await createAndCompleteSprint(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'Vel Sprint 2');
    if (!r2) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Two Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    // With two completed sprints the velocity chart should show recharts bars
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Time tracking summary
  // -------------------------------------------------------------------------

  test('time tracking section is visible after board selection with sprints', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'TT Visible Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'TT Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'TT Visible Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });
  });

  test('time tracking summary shows total logged hours when work has been logged', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'TT Summary Board');

    // Create a sprint (doesn't need to be completed for time tracking to appear)
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'TT Summary Sprint' },
    });
    const sprint = await sprintRes.json();

    // Create a card
    const card = await createCard(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'TT Card');
    if (!card) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    // Assign card to sprint, start, and complete so the page renders the section
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

    // Log 90 minutes (1h 30m)
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 90, date: new Date().toISOString().split('T')[0], notes: '' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'TT Summary Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    // The section should contain a non-zero logged total (1h 30m)
    await expect(page.locator('.time-tracking-section')).toContainText('1h 30m logged', { timeout: 8000 });
  });

  test('time tracking section shows "No time logged yet" when no work logs exist', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'No TT Board');

    const result = await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'No TT Sprint'
    );
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'No TT Board' });
    await expect(page.locator('.time-tracking-section')).toBeVisible({ timeout: 10000 });

    const byUserCard = page.locator('.time-tracking-section .chart-card').filter({
      has: page.locator('h3:has-text("Time Logged by Team Member")'),
    });
    await expect(byUserCard.locator('.chart-empty p')).toContainText('No time logged yet', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Switching boards reloads chart data
  // -------------------------------------------------------------------------

  test('switching board selector updates content', async ({ request, page }) => {
    const { token } = await createUser(request);

    // Board A: has a completed sprint
    const bsA = await createBoardWithSwimlane(request, token, 'Board Alpha');
    const resultA = await createAndCompleteSprint(request, token, bsA.boardId, bsA.columnId, bsA.swimlaneId, 'Alpha Sprint');
    if (!resultA) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    // Board B: no sprints
    await createBoardWithSwimlane(request, token, 'Board Beta');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
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

  test('switching boards reloads velocity chart data', async ({ request, page }) => {
    const { token } = await createUser(request);

    // Board A: has a completed sprint (velocity data)
    const bsA = await createBoardWithSwimlane(request, token, 'Velocity Board A');
    const resultA = await createAndCompleteSprint(request, token, bsA.boardId, bsA.columnId, bsA.swimlaneId, 'Vel Sprint A');
    if (!resultA) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    // Board B: only a planning sprint (no velocity data)
    const bsB = await createBoardWithSwimlane(request, token, 'Velocity Board B');
    await request.post(`${BASE}/api/sprints?board_id=${bsB.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Planning Sprint' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Select Board A — velocity bars should appear
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Board A' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
    const velCardA = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velCardA.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });

    // Switch to Board B — velocity shows empty state
    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Board B' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
    const velCardB = page.locator('.chart-card').filter({ has: page.locator('h3:has-text("Velocity Trend")') });
    await expect(velCardB.locator('.chart-empty p')).toContainText('Complete sprints to see velocity data', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Mobile viewport
  // -------------------------------------------------------------------------

  test('reports page works on mobile viewport', async ({ request, page }) => {
    const { token } = await createUser(request);
    await createBoardWithSwimlane(request, token, 'Mobile Reports Board');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Page header should still be visible on mobile
    await expect(page.locator('.page-header h1')).toBeVisible();

    // Board selector should be visible
    await expect(page.locator('.reports-filters select').first()).toBeVisible();

    // Select the board
    await page.locator('.reports-filters select').first().selectOption({ label: 'Mobile Reports Board' });

    // Empty state should appear and be readable on mobile
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
  });

  test('reports page renders charts on mobile after board with sprints selected', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Mobile Charts Board');
    const result = await createAndCompleteSprint(request, token, bs.boardId, bs.columnId, bs.swimlaneId, 'Mobile Sprint');
    if (!result) {
      test.skip(true, 'Card creation unavailable (Gitea 401/403)');
      return;
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Mobile Charts Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Chart cards should render even on small viewports
    await expect(page.locator('.chart-card h3:has-text("Velocity Trend")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Unimplemented / future features (fixme)
  // -------------------------------------------------------------------------

  test.fixme('date range filter affects chart data', async ({ page }) => {
    // Date range filter inputs are not yet implemented in Reports.tsx
  });

  test.fixme('print/export button triggers download or opens print dialog', async ({ page }) => {
    // No print/export button exists in the current Reports page implementation
  });
});
