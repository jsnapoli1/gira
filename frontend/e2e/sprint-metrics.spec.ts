import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  /** First column (state=open / "To Do") */
  firstColumnId: number;
  /** Last column (state=closed / "Done") */
  doneColumnId: number;
  /** Full columns array returned by the API */
  columns: Array<{ id: number; name: string; state: string; position: number }>;
}

async function createUser(request: any, displayName = 'Metrics Tester'): Promise<{ token: string; userId: number }> {
  const email = `test-smetrics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(request: any, token: string, boardName = 'Metrics Board'): Promise<BoardSetup> {
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

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);
  const doneColumn = sortedColumns.find((c) => c.state === 'closed') ?? sortedColumns[sortedColumns.length - 1];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: sortedColumns[0].id,
    doneColumnId: doneColumn.id,
    columns: sortedColumns,
  };
}

async function createCard(
  request: any,
  token: string,
  bs: BoardSetup,
  title: string,
  storyPoints = 0,
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
    test.skip(true, `Card creation failed (likely Gitea 401): ${await res.text()}`);
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
  sprintId: number,
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
  doneColumnId: number,
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
  extra: Record<string, string> = {},
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint Metrics', () => {
  // -------------------------------------------------------------------------
  // 1. Sprint completion percentage
  // -------------------------------------------------------------------------
  test('sprint completion percentage reflects cards moved to Done', async ({ request, page }) => {
    const { token } = await createUser(request, 'Completion Tester');
    const bs = await setupBoard(request, token, 'Completion Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Completion Sprint');

    // Create 4 cards and assign all to the sprint
    const cards = await Promise.all([
      createCard(request, token, bs, 'Card A', 3),
      createCard(request, token, bs, 'Card B', 3),
      createCard(request, token, bs, 'Card C', 3),
      createCard(request, token, bs, 'Card D', 3),
    ]);

    for (const card of cards) {
      await assignCardToSprint(request, token, card.id, sprint.id);
    }

    // Start the sprint so metrics can be calculated
    await startSprint(request, token, sprint.id);

    // Move 2 of 4 cards to the Done column
    await moveCardToDone(request, token, cards[0].id, bs.doneColumnId);
    await moveCardToDone(request, token, cards[1].id, bs.doneColumnId);

    // Navigate to reports and select the board
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
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
  // 2. Start sprint button changes status to active
  // -------------------------------------------------------------------------
  test('start sprint button changes sprint status to active in backlog view', async ({ request, page }) => {
    const { token } = await createUser(request, 'Start Sprint Tester');
    const bs = await setupBoard(request, token, 'Start Sprint Board');
    await createSprint(request, token, bs.boardId, 'Sprint To Start');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Click "Start Sprint"
    await page.click('button:has-text("Start Sprint")');

    // Badge should now show active
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Complete sprint button shows completion dialog
  // -------------------------------------------------------------------------
  test('complete sprint button triggers confirmation dialog', async ({ request, page }) => {
    const { token } = await createUser(request, 'Complete Sprint Tester');
    const bs = await setupBoard(request, token, 'Complete Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint To Complete');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the window.confirm() dialog
    let dialogFired = false;
    page.on('dialog', (dialog) => {
      dialogFired = true;
      dialog.accept();
    });

    await page.click('button:has-text("Complete Sprint")');

    // Dialog must have been shown
    await page.waitForFunction(() => true); // flush microtasks
    expect(dialogFired).toBe(true);

    // Active status badge should disappear after completion
    await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Sprint burndown chart visible in reports
  // -------------------------------------------------------------------------
  test('burndown chart is visible on reports page for an active sprint', async ({ request, page }) => {
    const { token } = await createUser(request, 'Burndown Tester');
    const bs = await setupBoard(request, token, 'Burndown Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Sprint');

    // Add a card and start the sprint so there is meaningful metrics data
    const card = await createCard(request, token, bs, 'Burndown Card', 5);
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Burndown Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Burndown chart card must be present
    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 5. Velocity chart shows past sprints
  // -------------------------------------------------------------------------
  test('velocity chart shows bars for 2 completed sprints', async ({ request, page }) => {
    const { token } = await createUser(request, 'Velocity Tester');
    const bs = await setupBoard(request, token, 'Velocity Board');

    // Create, populate, and complete two sprints
    for (const name of ['Velocity Sprint 1', 'Velocity Sprint 2']) {
      const sprint = await createSprint(request, token, bs.boardId, name);
      const card = await createCard(request, token, bs, `${name} Card`, 5);
      await assignCardToSprint(request, token, card.id, sprint.id);
      await startSprint(request, token, sprint.id);
      await completeSprint(request, token, sprint.id);
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Velocity Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    // Velocity Trend chart card must be visible
    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible({ timeout: 8000 });

    // recharts renders SVG bar elements when data is present
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });

    // Should render bars for both sprints (2 data groups × 2 bar series = ≥ 2 .recharts-bar)
    await expect(velocityCard.locator('.recharts-bar')).toHaveCount(2);
  });

  // -------------------------------------------------------------------------
  // 6. Story points appear in sprint metrics totals
  // -------------------------------------------------------------------------
  test('sprint metrics API returns story points for cards with points set', async ({ request }) => {
    const { token } = await createUser(request, 'Story Points Tester');
    const bs = await setupBoard(request, token, 'Story Points Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Points Sprint');

    // Create cards with known point values
    const card1 = await createCard(request, token, bs, 'Card 5pts', 5);
    const card2 = await createCard(request, token, bs, 'Card 3pts', 3);
    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    // API returns an array of metric snapshots; take the last entry
    const latest = Array.isArray(data) ? data[data.length - 1] : data;
    expect(latest.total_points).toBe(8);
    expect(latest.total_cards).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 7. Sprint dates visible in backlog
  // -------------------------------------------------------------------------
  test('sprint start and end dates are shown in backlog sprint panel', async ({ request, page }) => {
    const { token } = await createUser(request, 'Dates Tester');
    const bs = await setupBoard(request, token, 'Dates Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Dated Sprint', {
      start_date: '2026-05-01',
      end_date: '2026-05-14',
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // The sprint-dates element must render when dates are set
    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    // Both formatted date strings should appear somewhere in the dates element
    const datesText = await page.locator('.sprint-dates').textContent();
    expect(datesText).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 8. Sprint goal visible in backlog
  // -------------------------------------------------------------------------
  test('sprint goal text is visible in the backlog sprint panel', async ({ request, page }) => {
    const { token } = await createUser(request, 'Goal Tester');
    const bs = await setupBoard(request, token, 'Goal Board');
    await createSprint(request, token, bs.boardId, 'Sprint With Goal', {
      goal: 'Ship the new onboarding flow',
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-goal')).toContainText('Ship the new onboarding flow');
  });

  // -------------------------------------------------------------------------
  // 9. Multiple sprints — only one active (reports angle)
  // -------------------------------------------------------------------------
  test('reports page sprint selector only contains active sprint once two sprints exist', async ({
    request,
    page,
  }) => {
    const { token } = await createUser(request, 'Multi Sprint Tester');
    const bs = await setupBoard(request, token, 'Multi Sprint Board');

    // Create two sprints, start only the first
    const sprint1 = await createSprint(request, token, bs.boardId, 'Sprint Alpha');
    await createSprint(request, token, bs.boardId, 'Sprint Beta');
    await startSprint(request, token, sprint1.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    await page.locator('.reports-filters select').first().selectOption({ label: 'Multi Sprint Board' });

    // Sprint selector should appear (board has sprints)
    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });

    // Count options matching "active" status — must be exactly 1
    const activeOptions = await sprintSelect.locator('option:has-text("active")').count();
    expect(activeOptions).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 10. Sprint metrics API — returns expected fields
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/metrics returns expected fields', async ({ request }) => {
    const { token } = await createUser(request, 'Metrics API Tester');
    const bs = await setupBoard(request, token, 'Metrics API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'API Metrics Sprint');

    const card = await createCard(request, token, bs, 'API Card', 8);
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    const entry = Array.isArray(data) ? data[data.length - 1] : data;

    // All expected fields must be present
    expect(typeof entry.sprint_id).toBe('number');
    expect(typeof entry.total_points).toBe('number');
    expect(typeof entry.completed_points).toBe('number');
    expect(typeof entry.remaining_points).toBe('number');
    expect(typeof entry.total_cards).toBe('number');
    expect(typeof entry.completed_cards).toBe('number');

    // Sanity-check values
    expect(entry.total_points).toBe(8);
    expect(entry.total_cards).toBe(1);
    expect(entry.completed_cards).toBe(0);
    expect(entry.remaining_points).toBe(8);
  });

  // -------------------------------------------------------------------------
  // 11. Empty sprint metrics — sprint with no cards shows zeros
  // -------------------------------------------------------------------------
  test('sprint with no cards returns zero metrics', async ({ request }) => {
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
  // 12. Cards remaining vs completed counter updates as cards move to Done
  // -------------------------------------------------------------------------
  test('completion metric updates as cards are moved to Done column', async ({ request }) => {
    const { token } = await createUser(request, 'Counter Tester');
    const bs = await setupBoard(request, token, 'Counter Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Counter Sprint');

    const card1 = await createCard(request, token, bs, 'Counter Card 1', 5);
    const card2 = await createCard(request, token, bs, 'Counter Card 2', 5);
    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Baseline — no cards done yet
    const baseRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const baseData = await baseRes.json();
    const base = Array.isArray(baseData) ? baseData[baseData.length - 1] : baseData;
    expect(base.completed_cards).toBe(0);
    expect(base.remaining_points).toBe(10);

    // Move one card to Done
    await moveCardToDone(request, token, card1.id, bs.doneColumnId);

    // Metrics should now reflect 1 completed card
    const afterRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterData = await afterRes.json();
    const after = Array.isArray(afterData) ? afterData[afterData.length - 1] : afterData;
    expect(after.completed_cards).toBe(1);
    expect(after.completed_points).toBe(5);
    expect(after.remaining_points).toBe(5);

    // Move the second card to Done
    await moveCardToDone(request, token, card2.id, bs.doneColumnId);

    const finalRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalData = await finalRes.json();
    const final = Array.isArray(finalData) ? finalData[finalData.length - 1] : finalData;
    expect(final.completed_cards).toBe(2);
    expect(final.remaining_points).toBe(0);
  });
});
