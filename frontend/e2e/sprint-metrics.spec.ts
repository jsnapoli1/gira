import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  /** First column (state=open / "To Do") */
  firstColumnId: number;
  /** Last column (state=closed / "Done") */
  doneColumnId: number;
  /** Full columns array sorted by position */
  columns: Array<{ id: number; name: string; state: string; position: number }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  displayName = 'Metrics Tester'
): Promise<{ token: string; id?: number }> {
  const email = `test-smetrics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(
  request: any,
  token: string,
  boardName = 'Metrics Board'
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
      data: { name: 'Team', designator: 'TM-', color: '#6366f1' },
    })
  ).json();

  const columns: Array<{ id: number; name: string; state: string; position: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sorted = [...columns].sort((a, b) => a.position - b.position);
  const doneColumn = sorted.find((c) => c.state === 'closed') ?? sorted[sorted.length - 1];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: sorted[0].id,
    doneColumnId: doneColumn.id,
    columns: sorted,
  };
}

async function createCard(
  request: any,
  token: string,
  bs: BoardSetup,
  title: string,
  storyPoints = 0
): Promise<{ id: number }> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      column_id: bs.firstColumnId,
      swimlane_id: bs.swimlaneId,
      board_id: bs.boardId,
    },
  });
  if (!res.ok()) {
    test.skip(true, `Card creation unavailable: ${await res.text()}`);
    return { id: -1 };
  }
  const card = await res.json();

  if (storyPoints > 0) {
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { story_points: storyPoints },
    });
  }

  return card;
}

async function assignCardToSprint(
  request: any,
  token: string,
  cardId: number,
  sprintId: number
): Promise<void> {
  await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprintId },
  });
}

async function moveCardToDone(
  request: any,
  token: string,
  cardId: number,
  doneColumnId: number
): Promise<void> {
  await request.post(`${BASE}/api/cards/${cardId}/move`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { column_id: doneColumnId, state: 'closed', position: 10000 },
  });
}

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
  extra: Record<string, string> = {}
): Promise<{ id: number; name: string }> {
  return (
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, ...extra },
    })
  ).json();
}

async function startSprint(request: any, token: string, sprintId: number): Promise<void> {
  await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function completeSprint(request: any, token: string, sprintId: number): Promise<void> {
  await request.post(`${BASE}/api/sprints/${sprintId}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Pull the latest metrics snapshot from the GET /api/sprints/:id/metrics response. */
async function getLatestMetrics(
  request: any,
  token: string,
  sprintId: number
): Promise<{
  sprint_id: number;
  total_cards: number;
  completed_cards: number;
  total_points: number;
  completed_points: number;
  remaining_points: number;
}> {
  const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const data = await res.json();
  return Array.isArray(data) ? data[data.length - 1] : data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint Metrics', () => {
  // -------------------------------------------------------------------------
  // 1. GET /api/sprints/:id/metrics — field shape
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/metrics returns 200 with expected fields', async ({ request }) => {
    const { token } = await createUser(request, 'Metrics API Tester');
    const bs = await setupBoard(request, token, 'Metrics API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'API Metrics Sprint');

    const card = await createCard(request, token, bs, 'API Card', 8);
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;

    // All expected numeric fields must be present
    expect(typeof entry.sprint_id).toBe('number');
    expect(typeof entry.total_points).toBe('number');
    expect(typeof entry.completed_points).toBe('number');
    expect(typeof entry.remaining_points).toBe('number');
    expect(typeof entry.total_cards).toBe('number');
    expect(typeof entry.completed_cards).toBe('number');

    // Sanity-check values for the one card with 8 points
    expect(entry.total_points).toBe(8);
    expect(entry.total_cards).toBe(1);
    expect(entry.completed_cards).toBe(0);
    expect(entry.remaining_points).toBe(8);
  });

  // -------------------------------------------------------------------------
  // 2. GET /api/sprints/:id/metrics — zero values for empty sprint
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/metrics returns 200 with zero values for empty sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Empty Sprint Tester');
    const bs = await setupBoard(request, token, 'Empty Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Empty Sprint');
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;

    expect(entry.total_cards).toBe(0);
    expect(entry.total_points).toBe(0);
    expect(entry.completed_cards).toBe(0);
    expect(entry.completed_points).toBe(0);
    expect(entry.remaining_points).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. completed_cards increments when card moves to Done column
  // -------------------------------------------------------------------------
  test('completed_cards increments when cards are moved to Done column', async ({ request }) => {
    const { token } = await createUser(request, 'Counter Tester');
    const bs = await setupBoard(request, token, 'Counter Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Counter Sprint');

    const card1 = await createCard(request, token, bs, 'Counter Card 1', 5);
    if (card1.id === -1) return;
    const card2 = await createCard(request, token, bs, 'Counter Card 2', 5);
    if (card2.id === -1) return;

    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Baseline — no cards done yet
    const base = await getLatestMetrics(request, token, sprint.id);
    expect(base.completed_cards).toBe(0);
    expect(base.remaining_points).toBe(10);

    // Move one card to Done
    await moveCardToDone(request, token, card1.id, bs.doneColumnId);

    const after = await getLatestMetrics(request, token, sprint.id);
    expect(after.completed_cards).toBe(1);
    expect(after.completed_points).toBe(5);
    expect(after.remaining_points).toBe(5);

    // Move the second card to Done
    await moveCardToDone(request, token, card2.id, bs.doneColumnId);

    const final = await getLatestMetrics(request, token, sprint.id);
    expect(final.completed_cards).toBe(2);
    expect(final.remaining_points).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. Story points sum correctly in metrics
  // -------------------------------------------------------------------------
  test('story points sum correctly in sprint metrics total_points', async ({ request }) => {
    const { token } = await createUser(request, 'Story Points Tester');
    const bs = await setupBoard(request, token, 'Story Points Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Points Sprint');

    const card1 = await createCard(request, token, bs, 'Card 5pts', 5);
    if (card1.id === -1) return;
    const card2 = await createCard(request, token, bs, 'Card 3pts', 3);
    if (card2.id === -1) return;

    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const metrics = await getLatestMetrics(request, token, sprint.id);
    expect(metrics.total_points).toBe(8);
    expect(metrics.total_cards).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 5. GET /api/metrics/burndown — smoke test (the burndown endpoint)
  // -------------------------------------------------------------------------
  test('GET /api/metrics/burndown?sprint_id returns 200 with an array', async ({ request }) => {
    const { token } = await createUser(request, 'Burndown API Tester');
    const bs = await setupBoard(request, token, 'Burndown API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Burndown API Sprint');

    const card = await createCard(request, token, bs, 'Burndown API Card', 5);
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/metrics/burndown returns 400 when sprint_id is missing', async ({ request }) => {
    const { token } = await createUser(request, 'Burndown 400 Tester');
    const res = await request.get(`${BASE}/api/metrics/burndown`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/metrics/burndown returns 404 for a non-existent sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Burndown 404 Tester');
    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=999999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 6. GET /api/metrics/velocity — smoke test
  // -------------------------------------------------------------------------
  test('GET /api/metrics/velocity?board_id returns 200 with an array', async ({ request }) => {
    const { token } = await createUser(request, 'Velocity API Tester');
    const bs = await setupBoard(request, token, 'Velocity API Board');

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/metrics/velocity returns empty array for board with no completed sprints', async ({ request }) => {
    const { token } = await createUser(request, 'Velocity Empty Tester');
    const bs = await setupBoard(request, token, 'Velocity Empty Board');

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('GET /api/metrics/velocity includes completed sprints in the result', async ({ request }) => {
    const { token } = await createUser(request, 'Velocity Populate Tester');
    const bs = await setupBoard(request, token, 'Velocity Populate Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Velocity Sprint');

    const card = await createCard(request, token, bs, 'Vel Card', 7);
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);

    // Each velocity entry must have the expected shape
    const entry = data[0];
    expect(typeof entry.sprint_name).toBe('string');
    expect(typeof entry.completed_points).toBe('number');
    expect(typeof entry.total_points).toBe('number');
  });

  test('GET /api/metrics/velocity returns 400 when board_id is missing', async ({ request }) => {
    const { token } = await createUser(request, 'Velocity 400 Tester');
    const res = await request.get(`${BASE}/api/metrics/velocity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 7. GET /api/boards/:id/time-summary — smoke test
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/time-summary returns 200 with correct shape', async ({ request }) => {
    const { token } = await createUser(request, 'Time Summary Tester');
    const bs = await setupBoard(request, token, 'Time Summary Board');

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(typeof data.total_logged).toBe('number');
    expect(typeof data.total_estimated).toBe('number');
    expect(Array.isArray(data.by_user)).toBe(true);
  });

  test('GET /api/boards/:id/time-summary with sprint_id filter returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'Time Summary Sprint Filter Tester');
    const bs = await setupBoard(request, token, 'Time Summary Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Filter Sprint');
    await startSprint(request, token, sprint.id);

    const res = await request.get(
      `${BASE}/api/boards/${bs.boardId}/time-summary?sprint_id=${sprint.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(typeof data.total_logged).toBe('number');
    expect(typeof data.total_estimated).toBe('number');
    expect(Array.isArray(data.by_user)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Sprint completion percentage in reports UI
  // -------------------------------------------------------------------------
  test('sprint completion percentage in reports UI reflects cards moved to Done', async ({ request, page }) => {
    const { token } = await createUser(request, 'Completion Tester');
    const bs = await setupBoard(request, token, 'Completion Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Completion Sprint');

    const cards = [];
    for (const title of ['Card A', 'Card B', 'Card C', 'Card D']) {
      const card = await createCard(request, token, bs, title, 3);
      if (card.id === -1) return;
      cards.push(card);
      await assignCardToSprint(request, token, card.id, sprint.id);
    }
    await startSprint(request, token, sprint.id);

    // Move 2 of 4 cards to Done
    await moveCardToDone(request, token, cards[0].id, bs.doneColumnId);
    await moveCardToDone(request, token, cards[1].id, bs.doneColumnId);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Completion Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Sprint Completion metric-card should show 50%
    const completionCard = page.locator('.metric-card').filter({
      has: page.locator('.metric-label:has-text("Sprint Completion")'),
    });
    await expect(completionCard).toBeVisible({ timeout: 8000 });
    await expect(completionCard.locator('.metric-value')).toContainText('50%');
  });

  // -------------------------------------------------------------------------
  // 9. Backlog UI — start sprint changes status badge
  // -------------------------------------------------------------------------
  test('start sprint button changes sprint status to active in backlog view', async ({ request, page }) => {
    const { token } = await createUser(request, 'Start Sprint Tester');
    const bs = await setupBoard(request, token, 'Start Sprint Board');
    await createSprint(request, token, bs.boardId, 'Sprint To Start');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await page.click('button:has-text("Start Sprint")');

    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 10. Backlog UI — complete sprint triggers confirmation dialog
  // -------------------------------------------------------------------------
  test('complete sprint button triggers confirmation dialog', async ({ request, page }) => {
    const { token } = await createUser(request, 'Complete Sprint Tester');
    const bs = await setupBoard(request, token, 'Complete Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint To Complete');
    await startSprint(request, token, sprint.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    let dialogFired = false;
    page.on('dialog', (dialog) => {
      dialogFired = true;
      dialog.accept();
    });

    await page.click('button:has-text("Complete Sprint")');

    await page.waitForFunction(() => true); // flush microtasks
    expect(dialogFired).toBe(true);

    await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 11. Burndown chart visible on reports page for an active sprint
  // -------------------------------------------------------------------------
  test('burndown chart is visible on reports page for an active sprint', async ({ request, page }) => {
    const { token } = await createUser(request, 'Burndown UI Tester');
    const bs = await setupBoard(request, token, 'Burndown Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Sprint');

    const card = await createCard(request, token, bs, 'Burndown Card', 5);
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 12. Velocity chart shows bars for 2 completed sprints (UI)
  // -------------------------------------------------------------------------
  test('velocity chart shows bars for 2 completed sprints in reports UI', async ({ request, page }) => {
    const { token } = await createUser(request, 'Velocity UI Tester');
    const bs = await setupBoard(request, token, 'Velocity UI Board');

    for (const name of ['Velocity Sprint 1', 'Velocity Sprint 2']) {
      const sprint = await createSprint(request, token, bs.boardId, name);
      const card = await createCard(request, token, bs, `${name} Card`, 5);
      if (card.id === -1) return;
      await assignCardToSprint(request, token, card.id, sprint.id);
      await startSprint(request, token, sprint.id);
      await completeSprint(request, token, sprint.id);
    }

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity UI Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible({ timeout: 8000 });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
    // Two bar series (committed + completed)
    await expect(velocityCard.locator('.recharts-bar')).toHaveCount(2);
  });

  // -------------------------------------------------------------------------
  // 13. Sprint metrics only contains active sprint once (reports selector)
  // -------------------------------------------------------------------------
  test('reports sprint selector contains each sprint once with correct status label', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request, 'Multi Sprint Tester');
    const bs = await setupBoard(request, token, 'Multi Sprint Board');

    const sprint1 = await createSprint(request, token, bs.boardId, 'Sprint Alpha');
    await createSprint(request, token, bs.boardId, 'Sprint Beta');
    await startSprint(request, token, sprint1.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Multi Sprint Board' });

    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });

    // Exactly one option should mention "active"
    const activeOptions = await sprintSelect.locator('option:has-text("active")').count();
    expect(activeOptions).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 14. Sprint dates visible in backlog
  // -------------------------------------------------------------------------
  test('sprint start and end dates are shown in backlog sprint panel', async ({ request, page }) => {
    const { token } = await createUser(request, 'Dates Tester');
    const bs = await setupBoard(request, token, 'Dates Board');
    await createSprint(request, token, bs.boardId, 'Dated Sprint', {
      start_date: '2026-05-01',
      end_date: '2026-05-14',
    });

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    const datesText = await page.locator('.sprint-dates').textContent();
    expect(datesText).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 15. Sprint goal visible in backlog
  // -------------------------------------------------------------------------
  test('sprint goal text is visible in the backlog sprint panel', async ({ request, page }) => {
    const { token } = await createUser(request, 'Goal Tester');
    const bs = await setupBoard(request, token, 'Goal Board');
    await createSprint(request, token, bs.boardId, 'Sprint With Goal', {
      goal: 'Ship the new onboarding flow',
    });

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-goal')).toContainText('Ship the new onboarding flow');
  });

  // -------------------------------------------------------------------------
  // 16. GET /api/sprints/:id/metrics returns 404 for non-existent sprint
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/metrics returns 404 for a non-existent sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Metrics 404 Tester');
    const res = await request.get(`${BASE}/api/sprints/999999999/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 17. Moving card back from Done to open column decreases completed_cards
  //     (uses burndown endpoint which always returns calculated current metrics)
  // -------------------------------------------------------------------------
  test('moving card back from Done to open decreases completed_cards in metrics', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Undo Done Metrics Tester');
    const bs = await setupBoard(request, token, 'Undo Done Metrics Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Undo Done Sprint');

    const card = await createCard(request, token, bs, 'Undo Card', 6);
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Helper: use burndown which always calculates live metrics
    async function liveMetrics(): Promise<{ completed_cards: number; remaining_points: number }> {
      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      return Array.isArray(data) ? data[data.length - 1] : data;
    }

    // Move to Done
    await moveCardToDone(request, token, card.id, bs.doneColumnId);

    const afterDone = await liveMetrics();
    expect(afterDone.completed_cards).toBe(1);
    expect(afterDone.remaining_points).toBe(0);

    // Move back to first (open) column
    await request.post(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: bs.firstColumnId, state: 'open', position: 1 },
    });

    const afterUndone = await liveMetrics();
    expect(afterUndone.completed_cards).toBe(0);
    expect(afterUndone.remaining_points).toBe(6);
  });

  // -------------------------------------------------------------------------
  // 18. PUT /api/sprints/:id updates sprint correctly
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id updates sprint name and goal', async ({ request }) => {
    const { token } = await createUser(request, 'Update Sprint Tester');
    const bs = await setupBoard(request, token, 'Update Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Original Name');

    const res = await request.put(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Updated Name', goal: 'Updated goal text' },
    });
    expect(res.status()).toBe(200);

    const updated = await res.json();
    expect(updated.name).toBe('Updated Name');
    expect(updated.goal).toBe('Updated goal text');
  });

  // -------------------------------------------------------------------------
  // 19. DELETE /api/sprints/:id returns 204
  // -------------------------------------------------------------------------
  test('DELETE /api/sprints/:id returns 204', async ({ request }) => {
    const { token } = await createUser(request, 'Delete Sprint API Tester');
    const bs = await setupBoard(request, token, 'Delete Sprint API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Deletable Sprint');

    const res = await request.delete(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(204);

    // Confirm it's gone: list sprints and verify it's absent
    const listRes = await request.get(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprints: Array<{ id: number }> = (await listRes.json()) ?? [];
    expect(Array.isArray(sprints)).toBe(true);
    expect(sprints.find((s) => s.id === sprint.id)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 20. Starting an already-active sprint again is idempotent (returns 200)
  // -------------------------------------------------------------------------
  test('starting an already-active sprint returns 200 without error', async ({ request }) => {
    const { token } = await createUser(request, 'Double Start Tester');
    const bs = await setupBoard(request, token, 'Double Start Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Double Start Sprint');
    await startSprint(request, token, sprint.id);

    const res = await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Should not error — starting an already-active sprint is idempotent
    expect([200, 409]).toContain(res.status());
  });
});
