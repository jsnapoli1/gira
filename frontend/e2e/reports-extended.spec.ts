import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  columnId: number;
}

async function createUser(request: any, displayName = 'Reports Tester'): Promise<{ token: string }> {
  const email = `test-rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
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

async function createCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title: string,
  storyPoints = 3
) {
  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    })
  ).json();
  if (storyPoints > 0) {
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { story_points: storyPoints },
    });
  }
  return card;
}

async function createAndCompleteSprint(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  sprintName = 'Sprint 1'
): Promise<{ sprintId: number }> {
  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  // Create a card and assign to the sprint
  const card = await createCard(request, token, boardId, columnId, swimlaneId, `${sprintName} Card`, 5);

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
    const bs = await createBoardWithSwimlane(request, token, 'Selector Test Board');

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

  test('sprint selector appears after completing a sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Sprint Selector Board');

    await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Completed Sprint'
    );

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Sprint Selector Board' });

    // After selecting a board with sprints, a second select (sprint selector) should appear
    await expect(page.locator('.reports-filters select').nth(1)).toBeVisible({ timeout: 8000 });
  });

  test('metrics section shows data after completed sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Metrics Board');

    await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Done Sprint'
    );

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

  test('velocity chart renders after completing a sprint', async ({ request, page }) => {
    const { token } = await createUser(request);
    const bs = await createBoardWithSwimlane(request, token, 'Velocity Chart Board');

    await createAndCompleteSprint(
      request,
      token,
      bs.boardId,
      bs.columnId,
      bs.swimlaneId,
      'Velocity Sprint'
    );

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
    // Use .first() because recharts renders two bar groups (committed + completed)
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('switching board selector updates content', async ({ request, page }) => {
    const { token } = await createUser(request);

    // Board A: has a completed sprint
    const bsA = await createBoardWithSwimlane(request, token, 'Board Alpha');
    await createAndCompleteSprint(request, token, bsA.boardId, bsA.columnId, bsA.swimlaneId, 'Alpha Sprint');

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
});
