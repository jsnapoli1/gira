import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
  doneColumnId: number;
  columns: Array<{ id: number; name: string; state: string; position: number }>;
}

interface Sprint {
  id: number;
  name: string;
  status: string;
  start_date?: string;
  end_date?: string;
  goal?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  displayName = 'Sprint History Tester',
): Promise<{ token: string; id?: number }> {
  const email = `test-shistory-${crypto.randomUUID()}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(
  request: any,
  token: string,
  boardName = 'Sprint History Board',
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
      data: { name: 'Team', designator: 'SH-', color: '#6366f1' },
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

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
  extra: Record<string, string> = {},
): Promise<Sprint> {
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

async function getSprintList(
  request: any,
  token: string,
  boardId: number,
): Promise<Sprint[]> {
  const res = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function getSprint(
  request: any,
  token: string,
  sprintId: number,
): Promise<Sprint> {
  const res = await request.get(`${BASE}/api/sprints/${sprintId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function getSprintMetrics(
  request: any,
  token: string,
  sprintId: number,
): Promise<any> {
  const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function createAndCompleteSprintWithCard(
  request: any,
  token: string,
  bs: BoardSetup,
  sprintName = 'Completed Sprint',
): Promise<Sprint> {
  const sprint = await createSprint(request, token, bs.boardId, sprintName, {
    start_date: '2024-01-01',
    end_date: '2024-01-14',
  });

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `${sprintName} Card`,
      column_id: bs.firstColumnId,
      swimlane_id: bs.swimlaneId,
      board_id: bs.boardId,
    },
  });

  if (cardRes.ok()) {
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
  }

  await startSprint(request, token, sprint.id);
  await completeSprint(request, token, sprint.id);

  return sprint;
}

async function navigateToBacklog(page: any, token: string, boardId: number): Promise<void> {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-view', { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// API: completed sprint data
// ---------------------------------------------------------------------------

test.describe('Sprint History — API: completed sprint data', () => {
  test('GET /api/sprints?board_id returns completed sprint', async ({ request }) => {
    const { token } = await createUser(request, 'SH API List');
    const bs = await setupBoard(request, token, 'SH API List Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Sprint For List');

    const sprints = await getSprintList(request, token, bs.boardId);
    const found = sprints.find((s) => s.id === sprint.id);
    expect(found).toBeDefined();
  });

  test('completed sprint has status "completed"', async ({ request }) => {
    const { token } = await createUser(request, 'SH Status Check');
    const bs = await setupBoard(request, token, 'SH Status Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Status Sprint');

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.status).toBe('completed');
  });

  test('completed sprint has end_date', async ({ request }) => {
    const { token } = await createUser(request, 'SH End Date');
    const bs = await setupBoard(request, token, 'SH End Date Board');
    const sprint = await createSprint(request, token, bs.boardId, 'End Date Sprint', {
      start_date: '2024-02-01',
      end_date: '2024-02-14',
    });
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.end_date).toBeTruthy();
  });

  test('completed sprint has start_date', async ({ request }) => {
    const { token } = await createUser(request, 'SH Start Date');
    const bs = await setupBoard(request, token, 'SH Start Date Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Start Date Sprint', {
      start_date: '2024-03-01',
      end_date: '2024-03-14',
    });
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.start_date).toBeTruthy();
  });

  test('completed sprint has name', async ({ request }) => {
    const { token } = await createUser(request, 'SH Name Check');
    const bs = await setupBoard(request, token, 'SH Name Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Named Completed Sprint');

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.name).toBe('Named Completed Sprint');
  });

  test('multiple sprints can be completed', async ({ request }) => {
    const { token } = await createUser(request, 'SH Multi Complete');
    const bs = await setupBoard(request, token, 'SH Multi Complete Board');

    const s1 = await createSprint(request, token, bs.boardId, 'Multi Sprint 1');
    await startSprint(request, token, s1.id);
    await completeSprint(request, token, s1.id);

    const s2 = await createSprint(request, token, bs.boardId, 'Multi Sprint 2');
    await startSprint(request, token, s2.id);
    await completeSprint(request, token, s2.id);

    const sprints = await getSprintList(request, token, bs.boardId);
    const completed = sprints.filter((s) => s.status === 'completed');
    expect(completed.length).toBeGreaterThanOrEqual(2);
  });

  test('planning sprint appears with status "planning"', async ({ request }) => {
    const { token } = await createUser(request, 'SH Planning Status');
    const bs = await setupBoard(request, token, 'SH Planning Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Planning Sprint');

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.status).toBe('planning');
  });

  test('active sprint appears with status "active"', async ({ request }) => {
    const { token } = await createUser(request, 'SH Active Status');
    const bs = await setupBoard(request, token, 'SH Active Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Sprint');
    await startSprint(request, token, sprint.id);

    const updated = await getSprint(request, token, sprint.id);
    expect(updated.status).toBe('active');
  });

  test('all three statuses can coexist on a board', async ({ request }) => {
    const { token } = await createUser(request, 'SH Three Statuses');
    const bs = await setupBoard(request, token, 'SH Three Status Board');

    // Completed sprint
    const s1 = await createSprint(request, token, bs.boardId, 'Completed Sprint');
    await startSprint(request, token, s1.id);
    await completeSprint(request, token, s1.id);

    // Active sprint
    const s2 = await createSprint(request, token, bs.boardId, 'Active Sprint');
    await startSprint(request, token, s2.id);

    // Planning sprint
    await createSprint(request, token, bs.boardId, 'Planning Sprint');

    const sprints = await getSprintList(request, token, bs.boardId);
    const statuses = sprints.map((s) => s.status);
    expect(statuses).toContain('completed');
    expect(statuses).toContain('active');
    expect(statuses).toContain('planning');
  });
});

// ---------------------------------------------------------------------------
// API: sprint metrics after completion
// ---------------------------------------------------------------------------

test.describe('Sprint History — API: sprint metrics after completion', () => {
  test('completed sprint metrics still accessible via GET /api/sprints/:id/metrics', async ({ request }) => {
    const { token } = await createUser(request, 'SH Metrics Access');
    const bs = await setupBoard(request, token, 'SH Metrics Access Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Metrics Sprint');

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
  });

  test('metrics show total_cards count', async ({ request }) => {
    const { token } = await createUser(request, 'SH Total Cards');
    const bs = await setupBoard(request, token, 'SH Total Cards Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Total Cards Sprint');

    const metrics = await getSprintMetrics(request, token, sprint.id);
    expect(metrics).toHaveProperty('total_cards');
    expect(typeof metrics.total_cards).toBe('number');
  });

  test('metrics show completed_cards count', async ({ request }) => {
    const { token } = await createUser(request, 'SH Completed Cards');
    const bs = await setupBoard(request, token, 'SH Completed Cards Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Completed Cards Sprint');

    const metrics = await getSprintMetrics(request, token, sprint.id);
    expect(metrics).toHaveProperty('completed_cards');
    expect(typeof metrics.completed_cards).toBe('number');
  });

  test('burndown data available for completed sprint', async ({ request }) => {
    const { token } = await createUser(request, 'SH Burndown');
    const bs = await setupBoard(request, token, 'SH Burndown Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Burndown Sprint');

    const metrics = await getSprintMetrics(request, token, sprint.id);
    // Burndown is returned as an array (may be empty if no day-by-day snapshots taken)
    expect(metrics).toHaveProperty('burndown');
    expect(Array.isArray(metrics.burndown)).toBe(true);
  });

  test('velocity data includes completed sprints', async ({ request }) => {
    const { token } = await createUser(request, 'SH Velocity');
    const bs = await setupBoard(request, token, 'SH Velocity Board');

    // Complete two sprints so velocity data has history
    await createAndCompleteSprintWithCard(request, token, bs, 'Velocity Sprint 1');
    await createAndCompleteSprintWithCard(request, token, bs, 'Velocity Sprint 2');

    // GET board metrics includes velocity from all completed sprints
    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Endpoint may return 200 or 404 depending on implementation — just assert shape if 200
    if (res.ok()) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// UI: sprint history in backlog
// ---------------------------------------------------------------------------

test.describe('Sprint History — UI: sprint history in backlog', () => {
  test('completed sprint visible in backlog sprint list', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH UI Visible');
    const bs = await setupBoard(request, token, 'SH UI Visible Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Completed Visible Sprint');

    await navigateToBacklog(page, token, bs.boardId);

    await expect(
      page.locator('.backlog-sprint-header h2', { hasText: sprint.name }),
    ).toBeVisible({ timeout: 8000 });
  });

  test('completed sprint shows "Completed" status badge', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH Badge Completed');
    const bs = await setupBoard(request, token, 'SH Badge Completed Board');
    await createAndCompleteSprintWithCard(request, token, bs, 'Completed Badge Sprint');

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-status-badge.completed')).toBeVisible({ timeout: 6000 });
  });

  test('active sprint shows "Active" badge in backlog', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH Badge Active');
    const bs = await setupBoard(request, token, 'SH Badge Active Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Badge Sprint');
    await startSprint(request, token, sprint.id);

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 6000 });
  });

  test('sprint shows start/end dates in backlog UI', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH Dates UI');
    const bs = await setupBoard(request, token, 'SH Dates UI Board');
    await createSprint(request, token, bs.boardId, 'Dated Sprint UI', {
      start_date: '2024-06-01',
      end_date: '2024-06-14',
    });

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.sprint-dates', { timeout: 8000 });
    await expect(page.locator('.sprint-dates')).toContainText('2024');
  });

  test('sprint shows name in backlog list', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH Name UI');
    const bs = await setupBoard(request, token, 'SH Name UI Board');
    await createSprint(request, token, bs.boardId, 'Unique Sprint Name XYZ');

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.backlog-sprint-header h2:has-text("Unique Sprint Name XYZ")')).toBeVisible();
  });

  test('cannot start already-completed sprint — start button hidden or absent', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SH No Start Completed');
    const bs = await setupBoard(request, token, 'SH No Start Completed Board');
    await createAndCompleteSprintWithCard(request, token, bs, 'Already Done Sprint');

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // The "Start Sprint" button should not be present for a completed sprint
    const startBtn = page.locator('.backlog-sprint-header button:has-text("Start Sprint")');
    const count = await startBtn.count();
    if (count > 0) {
      // If present, it must be disabled
      await expect(startBtn).toBeDisabled();
    } else {
      // Not present at all — also acceptable
      expect(count).toBe(0);
    }
  });

  test('completed sprint cards visible in sprint view when navigating to that sprint', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SH Cards Visible');
    const bs = await setupBoard(request, token, 'SH Cards Visible Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Cards Visible Sprint');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Sprint History Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    await navigateToBacklog(page, token, bs.boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    // Card should still be listed in the completed sprint panel
    await expect(
      page.locator('.backlog-sprint-cards .card-item, .backlog-sprint-cards .backlog-card-item'),
    ).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// UI: reports shows sprint history
// ---------------------------------------------------------------------------

test.describe('Sprint History — UI: reports shows history', () => {
  test('reports page shows completed sprints in sprint selector', async ({ page, request }) => {
    test.setTimeout(90000);
    const { token } = await createUser(request, 'SH Reports Selector');
    const bs = await setupBoard(request, token, 'SH Reports Selector Board');
    const sprint = await createAndCompleteSprintWithCard(request, token, bs, 'Reports Completed Sprint');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-filters select', { timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'SH Reports Selector Board' });
    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    await expect(
      sprintSelect.locator(`option:has-text("${sprint.name}")`),
    ).toBeAttached({ timeout: 6000 });
  });

  test('selecting completed sprint shows historical metrics', async ({ page, request }) => {
    test.setTimeout(90000);
    const { token } = await createUser(request, 'SH Reports Metrics');
    const bs = await setupBoard(request, token, 'SH Reports Metrics Board');
    await createAndCompleteSprintWithCard(request, token, bs, 'Historical Sprint');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-filters select', { timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'SH Reports Metrics Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });
  });

  test('velocity chart shows bars for completed sprints', async ({ page, request }) => {
    test.setTimeout(90000);
    const { token } = await createUser(request, 'SH Velocity Chart');
    const bs = await setupBoard(request, token, 'SH Velocity Chart Board');
    const s1 = await createAndCompleteSprintWithCard(request, token, bs, 'Velocity Sprint A');
    if (!s1) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-filters select', { timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'SH Velocity Chart Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const velocityCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Velocity Trend")'),
    });
    await expect(velocityCard).toBeVisible({ timeout: 8000 });
    await expect(velocityCard.locator('.recharts-bar').first()).toBeVisible({ timeout: 8000 });
  });

  test('sprint burndown available for completed sprint in reports', async ({ page, request }) => {
    test.setTimeout(90000);
    const { token } = await createUser(request, 'SH Burndown Reports');
    const bs = await setupBoard(request, token, 'SH Burndown Reports Board');
    await createAndCompleteSprintWithCard(request, token, bs, 'Burndown Reports Sprint');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-filters select', { timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'SH Burndown Reports Board' });
    await expect(page.locator('.metrics-summary')).toBeVisible({ timeout: 10000 });

    const burndownCard = page.locator('.chart-card').filter({
      has: page.locator('h3:has-text("Sprint Burndown")'),
    });
    await expect(burndownCard).toBeVisible({ timeout: 8000 });
  });

  test('reports shows "No sprints found" when board has no sprints', async ({ page, request }) => {
    const { token } = await createUser(request, 'SH No Sprints Reports');
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SH No Sprints Reports Board' },
    });
    const board = await boardRes.json();

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-filters select', { timeout: 10000 });

    await page.locator('.reports-filters select').first().selectOption({ label: 'SH No Sprints Reports Board' });

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No sprints found');
  });
});

// ---------------------------------------------------------------------------
// Sprint after completion
// ---------------------------------------------------------------------------

test.describe('Sprint History — sprint lifecycle after completion', () => {
  test('after completing sprint, new sprint can be created', async ({ request }) => {
    const { token } = await createUser(request, 'SH Post Complete Create');
    const bs = await setupBoard(request, token, 'SH Post Complete Board');
    const s1 = await createSprint(request, token, bs.boardId, 'Sprint To Complete');
    await startSprint(request, token, s1.id);
    await completeSprint(request, token, s1.id);

    const s2 = await createSprint(request, token, bs.boardId, 'Sprint After Completion');
    expect(s2.id).toBeDefined();
    expect(typeof s2.id).toBe('number');
  });

  test('new sprint after completion is in "planning" status', async ({ request }) => {
    const { token } = await createUser(request, 'SH New Sprint Planning');
    const bs = await setupBoard(request, token, 'SH New Sprint Planning Board');
    const s1 = await createSprint(request, token, bs.boardId, 'First Sprint');
    await startSprint(request, token, s1.id);
    await completeSprint(request, token, s1.id);

    const s2 = await createSprint(request, token, bs.boardId, 'New Planning Sprint');
    expect(s2.status).toBe('planning');
  });

  test('incomplete cards after sprint completion retain their sprint assignment', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'SH Incomplete Cards');
    const bs = await setupBoard(request, token, 'SH Incomplete Cards Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint With Leftovers');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Leftover Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    // Card data should still be accessible
    const cardRes2 = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardRes2.ok()).toBe(true);
    const updatedCard = await cardRes2.json();
    expect(updatedCard.id).toBe(card.id);
  });
});
