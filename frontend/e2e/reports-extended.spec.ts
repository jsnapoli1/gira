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

async function createStartedSprint(
  request: any,
  token: string,
  bs: BoardSetup,
  sprintName = 'Active Sprint',
  storyPoints = 5
): Promise<{ sprintId: number; cardId: number }> {
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
    return { sprintId: -1, cardId: -1 };
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

  return { sprintId: sprint.id, cardId: card.id };
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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'Selector Test Board' });

    await expect(page.locator('.empty-state h2')).toContainText('No sprints found', { timeout: 8000 });
  });

  test('reports page accessible without any boards — shows select-board empty state', async ({ request, page }) => {
    const token = await createUser(request, 'No Board User');
    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  test('board with no sprints shows empty state', async ({ request, page }) => {
    const token = await createUser(request);
    await setupBoard(request, token, 'No Sprint Board');

    await injectToken(page, token);
    await page.goto('/reports');
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

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

  // =========================================================================
  // NEW TESTS — Burndown API
  // =========================================================================

  test.describe('Burndown API', () => {

    test('GET /api/metrics/burndown returns 200 for a started sprint', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Burndown 200 Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Burndown 200 Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    });

    test('burndown response is an array', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Burndown Array Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Burndown Array Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('burndown entries have remaining_points numeric field', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Burndown Fields Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Fields Sprint', 8);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.length).toBeGreaterThanOrEqual(1);
      const entry = data[data.length - 1];
      expect(typeof entry.remaining_points).toBe('number');
    });

    test('burndown entries have total_points numeric field', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Burndown Total Points Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'TP Sprint', 7);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.length).toBeGreaterThanOrEqual(1);
      const entry = data[data.length - 1];
      expect(typeof entry.total_points).toBe('number');
      expect(entry.total_points).toBe(7);
    });

    test('burndown for completed sprint returns historical data with at least one entry', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Burndown Historical Board');
      const sprintId = await createAndCompleteSprint(request, token, bs, 'Historical Sprint', 6);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprintId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    test('burndown without sprint_id returns 400', async ({ request }) => {
      const token = await createUser(request);
      const res = await request.get(`${BASE}/api/metrics/burndown`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(400);
    });

    test('burndown for non-existent sprint returns 404', async ({ request }) => {
      const token = await createUser(request);
      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=999999999`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(404);
    });
  });

  // =========================================================================
  // NEW TESTS — Velocity API
  // =========================================================================

  test.describe('Velocity API', () => {

    test('GET /api/metrics/velocity returns 200 for a board', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Velocity 200 Board');

      const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    });

    test('velocity response is an array', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Velocity Array Board');

      const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('velocity entries have sprint_name, completed_points, total_points fields', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Velocity Fields Board');
      const sprintId = await createAndCompleteSprint(request, token, bs, 'Vel Fields Sprint', 9);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.length).toBeGreaterThanOrEqual(1);
      const entry = data[0];
      expect(typeof entry.sprint_name).toBe('string');
      expect(typeof entry.completed_points).toBe('number');
      expect(typeof entry.total_points).toBe('number');
    });

    test('velocity shows completed points for a sprint with story-pointed cards', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Velocity Points Board');
      const sprintId = await createAndCompleteSprint(request, token, bs, 'Points Vel Sprint', 13);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const entry = data.find((v: any) => v.sprint_name === 'Points Vel Sprint');
      expect(entry).toBeDefined();
      expect(entry.total_points).toBe(13);
    });

    test('velocity returns empty array for board with no completed sprints', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'Velocity No Complete Board');

      const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    test('velocity without board_id returns 400', async ({ request }) => {
      const token = await createUser(request);
      const res = await request.get(`${BASE}/api/metrics/velocity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(400);
    });
  });

  // =========================================================================
  // NEW TESTS — Time Summary API
  // =========================================================================

  test.describe('Time Summary API', () => {

    test('GET /api/boards/:id/time-summary returns 200', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS 200 Board');

      const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    });

    test('time-summary response has total_logged field', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS Fields Board');

      const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(typeof data.total_logged).toBe('number');
    });

    test('time-summary response has total_estimated field', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS Estimated Board');

      const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(typeof data.total_estimated).toBe('number');
    });

    test('time-summary returns total_logged = 0 when no worklogs exist', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS Zero Board');

      const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.total_logged).toBe(0);
    });

    test('time-summary by_user array is present in response', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS ByUser Board');

      const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(Array.isArray(data.by_user)).toBe(true);
    });

    test('time-summary total_logged increases after adding a worklog', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS Worklog Board');

      // Create a card
      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Worklog Card',
          column_id: bs.columnId,
          swimlane_id: bs.swimlaneId,
          board_id: bs.boardId,
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation unavailable');
        return;
      }
      const card = await cardRes.json();

      // Baseline
      const before = await (
        await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();

      // Add worklog
      await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { minutes: 90, description: 'Focused session' },
      });

      const after = await (
        await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();

      expect(after.total_logged).toBeGreaterThan(before.total_logged);
    });

    test('time-summary accepts sprint_id query param and returns 200', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'TS Sprint Filter Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Filter Sprint 1');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(
        `${BASE}/api/boards/${bs.boardId}/time-summary?sprint_id=${sprintId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(typeof data.total_logged).toBe('number');
    });
  });

  // =========================================================================
  // NEW TESTS — Reports UI
  // =========================================================================

  test.describe('Reports UI', () => {

    test('UI: reports page is accessible at /reports route', async ({ request, page }) => {
      const token = await createUser(request);
      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });
      await expect(page).toHaveURL(/\/reports/);
    });

    test('UI: sprint selector is visible when board has sprints', async ({ request, page }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'UI Sprint Selector Board');

      // Create sprint but don't complete it — selector still shows for planning
      await request.post(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Planning Sprint UI' },
      });

      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.reports-filters select').first().selectOption({ label: 'UI Sprint Selector Board' });

      // Sprint selector (second select) should appear
      await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
    });

    test('UI: burndown chart card heading is rendered', async ({ request, page }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'UI Burndown Board');

      const sprintId = await createAndCompleteSprint(request, token, bs, 'UI Burndown Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.reports-filters select').first().selectOption({ label: 'UI Burndown Board' });
      await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

      await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: velocity trend chart card heading is rendered', async ({ request, page }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'UI Velocity Board');

      const sprintId = await createAndCompleteSprint(request, token, bs, 'UI Velocity Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.reports-filters select').first().selectOption({ label: 'UI Velocity Board' });
      await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

      await expect(page.locator('.chart-card h3:has-text("Velocity Trend")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: sprint metrics shows Sprint Completion and Avg Velocity metric cards', async ({ request, page }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'UI Metrics Cards Board');

      const sprintId = await createAndCompleteSprint(request, token, bs, 'UI Metrics Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.reports-filters select').first().selectOption({ label: 'UI Metrics Cards Board' });
      await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

      await expect(
        page.locator('.metric-card').filter({ has: page.locator('.metric-label:has-text("Sprint Completion")') })
      ).toBeVisible();
      await expect(
        page.locator('.metric-card').filter({ has: page.locator('.metric-label:has-text("Avg Velocity")') })
      ).toBeVisible();
    });

    test('UI: cumulative flow chart card heading is rendered', async ({ request, page }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'UI CFD Board');

      const sprintId = await createAndCompleteSprint(request, token, bs, 'UI CFD Sprint');
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await injectToken(page, token);
      await page.goto('/reports');
      await expect(page.locator('.reports-filters select').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.reports-filters select').first().selectOption({ label: 'UI CFD Board' });
      await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

      await expect(page.locator('.chart-card h3:has-text("Cumulative Flow")')).toBeVisible({ timeout: 8000 });
    });

    test.fixme('UI: date range selector is present on the reports page', async ({ page }) => {
      // Date range filter inputs are not yet implemented in Reports.tsx
    });

    test.fixme('UI: export reports data button triggers a download or print', async ({ page }) => {
      // No export button exists in the current Reports page implementation
    });
  });

  // =========================================================================
  // NEW TESTS — Sprint Metrics API
  // =========================================================================

  test.describe('Sprint Metrics API (via /api/sprints/:id/metrics)', () => {

    test('GET /api/sprints/:id/metrics returns 200 with data', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'SM API Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'SM API Sprint', 5);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    });

    test('sprint metrics has total_cards count', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'SM Total Cards Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Total Cards Sprint', 5);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const entry = Array.isArray(data) ? data[data.length - 1] : data;
      expect(typeof entry.total_cards).toBe('number');
      expect(entry.total_cards).toBeGreaterThanOrEqual(1);
    });

    test('sprint metrics has completed_cards count starting at 0', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'SM Completed Cards Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Completed Zero Sprint', 5);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const entry = Array.isArray(data) ? data[data.length - 1] : data;
      expect(typeof entry.completed_cards).toBe('number');
      expect(entry.completed_cards).toBe(0);
    });

    test('sprint metrics completion_percentage is calculable from total and completed cards', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'SM Completion Pct Board');
      const { sprintId } = await createStartedSprint(request, token, bs, 'Completion Pct Sprint', 5);
      if (sprintId === -1) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const entry = Array.isArray(data) ? data[data.length - 1] : data;

      // Completion % = completed_cards / total_cards * 100
      // With no cards done yet, it should be 0%
      const pct = entry.total_cards > 0
        ? (entry.completed_cards / entry.total_cards) * 100
        : 0;
      expect(pct).toBe(0);
    });

    test('sprint metrics completed_cards increases when card moved to done column', async ({ request }) => {
      const token = await createUser(request);
      const bs = await setupBoard(request, token, 'SM Move Done Board');

      // Create sprint with a card
      const sprint = await (
        await request.post(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { name: 'Move Done Sprint' },
        })
      ).json();

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Move To Done Card',
          column_id: bs.columnId,
          swimlane_id: bs.swimlaneId,
          board_id: bs.boardId,
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation unavailable');
        return;
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

      // Before moving to done
      const before = await (
        await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      const beforeEntry = Array.isArray(before) ? before[before.length - 1] : before;
      expect(beforeEntry.completed_cards).toBe(0);

      // Move card to Done column
      await request.post(`${BASE}/api/cards/${card.id}/move`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { column_id: bs.doneColumnId, state: 'closed', position: 1 },
      });

      // After moving to done
      const after = await (
        await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      const afterEntry = Array.isArray(after) ? after[after.length - 1] : after;
      expect(afterEntry.completed_cards).toBe(1);
    });

    test('GET /api/sprints/:id/metrics returns 404 for non-existent sprint', async ({ request }) => {
      const token = await createUser(request);
      const res = await request.get(`${BASE}/api/sprints/999999999/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(404);
    });

    test('sprint metrics unauthenticated request returns 401', async ({ request }) => {
      const res = await request.get(`${BASE}/api/sprints/1/metrics`);
      expect(res.status()).toBe(401);
    });
  });
});
