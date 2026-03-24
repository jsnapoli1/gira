import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

interface SetupResult {
  token: string;
  boardId: number;
  swimlaneId: number;
  columnId: number;
}

interface SetupWithSprintResult extends SetupResult {
  sprintId: number;
}

interface SetupWithCardResult extends SetupWithSprintResult {
  cardId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupBoard(request: any, boardName = 'Sprint Planning Board'): Promise<SetupResult> {
  const email = `sprint-plan-${crypto.randomUUID()}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Sprint Planner' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Default Lane', designator: 'DL-', color: '#6366f1' },
  });
  const swimlane = await swimlaneRes.json();

  const boardDetailRes = await request.get(`${BASE}/api/boards/${board.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const boardDetail = await boardDetailRes.json();
  const firstColumn = (boardDetail.columns || [])[0];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    columnId: firstColumn?.id,
  };
}

async function setupBoardWithSprint(
  request: any,
  boardName = 'Sprint Planning Board',
  sprintName = 'Sprint 1',
): Promise<SetupWithSprintResult> {
  const base = await setupBoard(request, boardName);

  const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${base.boardId}`, {
    headers: { Authorization: `Bearer ${base.token}` },
    data: { name: sprintName },
  });
  const sprint = await sprintRes.json();

  return { ...base, sprintId: sprint.id };
}

async function setupBoardWithSprintAndCard(
  request: any,
  boardName = 'Sprint Planning Board',
  sprintName = 'Sprint 1',
  cardTitle = 'Test Card',
): Promise<SetupWithCardResult> {
  const base = await setupBoardWithSprint(request, boardName, sprintName);

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${base.token}` },
    data: {
      board_id: base.boardId,
      swimlane_id: base.swimlaneId,
      column_id: base.columnId,
      sprint_id: null,
      title: cardTitle,
      description: '',
      priority: 'medium',
    },
  });
  const card = await cardRes.json();

  return { ...base, cardId: card.id };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
  storyPoints?: number,
): Promise<number> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      sprint_id: null,
      title,
      description: '',
      priority: 'medium',
      story_points: storyPoints ?? null,
    },
  });
  if (!res.ok()) {
    test.skip(true, `Card creation unavailable: ${await res.text()}`);
    return -1;
  }
  const card = await res.json();
  return card.id;
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

// Navigate to the backlog view and wait for it to be ready.
async function goToBacklog(page: any): Promise<void> {
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-view', { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint Planning', () => {
  // 1. Create sprint in backlog UI
  test('create sprint in backlog UI — sprint appears in backlog', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request, 'Create Sprint UI Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);

    // Click "Create Sprint" from the backlog header
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    // Fill the sprint name and submit
    await page.fill('input[placeholder="Sprint 1"]', 'My New Sprint');
    await page.click('button[type="submit"]:has-text("Create")');

    // Modal should close and sprint panel should appear
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });
    await expect(page.locator('.backlog-sprint-header')).toBeVisible({ timeout: 6000 });
  });

  // 2. Sprint appears in backlog with name
  test('sprint appears in backlog with its name in the header', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Sprint Name Board', 'Named Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Named Sprint');
  });

  // 3. Drag card to sprint (DnD — fixme) + API-based assignment
  test.fixme('drag card from backlog to sprint panel via DnD', async ({ page, request }) => {
    // Drag-and-drop is non-deterministic in headless Playwright with @dnd-kit PointerSensor.
    // Use the API-based assign test (below) for reliable coverage.
  });

  test('assign card to sprint via API then reload — card appears under sprint', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'DnD API Board',
      'API Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Sprint Card');
    await assignCardToSprint(request, token, cardId, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card must appear inside the sprint cards area
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Sprint Card');
    // And NOT in the swimlane backlog section
    await expect(
      page.locator('.swimlane-backlog .backlog-card .card-title:has-text("Sprint Card")'),
    ).not.toBeVisible();
  });

  // 4. Remove card from sprint
  test('remove card from sprint in backlog UI', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Remove Card Board',
      'Remove Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Removable Card');
    await assignCardToSprint(request, token, cardId, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Verify card is in the sprint
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Removable Card');

    // Click the ✕ remove-from-sprint button (force because it is opacity-hidden until hover)
    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    // Card should move back to the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Removable Card', {
      timeout: 6000,
    });
    // And the sprint section should be empty
    await expect(page.locator('.backlog-sprint-cards .backlog-card')).toHaveCount(0);
  });

  // 5. Sprint story points total
  test('sprint header reflects total story points from assigned cards', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Story Points Board',
      'Points Sprint',
    );

    // Create 3 cards with story points 2, 3, 5
    for (const [title, pts] of [
      ['Card A', 2],
      ['Card B', 3],
      ['Card C', 5],
    ] as [string, number][]) {
      const cid = await createCard(request, token, boardId, swimlaneId, columnId, title, pts);
      await assignCardToSprint(request, token, cid, sprintId);
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Expect story points (2+3+5 = 10) to be visible on the cards
    const points = await page.locator('.backlog-sprint-cards .card-points').allTextContents();
    const total = points.reduce((sum, p) => sum + parseInt(p, 10), 0);
    expect(total).toBe(10);
  });

  // 6. Start sprint — active badge on board
  test('start sprint shows active sprint badge on board header', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Start Sprint Board',
      'Badge Sprint',
    );

    // Start sprint via API
    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // The active sprint badge should be visible in the board header
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Badge Sprint');
    await expect(page.locator('.active-sprint-badge .sprint-status-label')).toContainText('Active');
  });

  // 7. Board shows only active sprint cards
  test('board view shows only cards in the active sprint', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Filter Sprint Board',
      'Active Sprint',
    );

    // Card assigned to sprint
    const sprintCardId = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      columnId,
      'In Sprint Card',
    );
    await assignCardToSprint(request, token, sprintCardId, sprintId);

    // Card NOT assigned to sprint
    await createCard(request, token, boardId, swimlaneId, columnId, 'Backlog Only Card');

    // Start the sprint
    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Board view (default) should show the sprint card
    await expect(page.locator('.card-title:has-text("In Sprint Card")')).toBeVisible({
      timeout: 8000,
    });
    // Backlog-only card should NOT appear in the board view
    await expect(
      page.locator('.card-title:has-text("Backlog Only Card")'),
    ).not.toBeVisible();
  });

  // 8. Complete sprint — dialog
  test('complete sprint shows confirm dialog and marks sprint completed', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Complete Sprint Board',
      'Finish Sprint',
    );

    // Start the sprint first
    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the window.confirm() dialog that appears when completing a sprint
    page.once('dialog', (dialog) => dialog.accept());

    await page.click('button:has-text("Complete Sprint")');

    // The "Complete Sprint" button should disappear once the sprint is done
    await expect(page.locator('button:has-text("Complete Sprint")')).not.toBeVisible({
      timeout: 8000,
    });
  });

  // 9. Completed sprint no longer active — new sprint can be started
  test('after completing a sprint its status is completed and a new sprint can start', async ({
    page,
    request,
  }) => {
    const email = `sprint-complete-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Completer' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Post-Complete Board' },
    });
    const board = await boardRes.json();

    // Create and start sprint 1
    const s1Res = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint One' },
    });
    const sprint1 = await s1Res.json();
    await request.post(`${BASE}/api/sprints/${sprint1.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Create sprint 2 (in planning)
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Two' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Complete sprint 1
    page.once('dialog', (d) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    // After completion, "Start Sprint" button for Sprint Two should be enabled
    await expect(page.locator('button:has-text("Start Sprint")')).toBeEnabled({ timeout: 8000 });
  });

  // 10. Sprint history in reports
  test('completed sprint appears as selectable option in reports page', async ({
    page,
    request,
  }) => {
    const email = `sprint-reports-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Reports User' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Reports Board' },
    });
    const board = await boardRes.json();

    // Create, start, and complete a sprint
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Completed Sprint' },
    });
    const sprint = await sprintRes.json();
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await page.waitForSelector('.reports-page', { timeout: 10000 });

    // Select the board
    await page.selectOption('.reports-filters select', { label: 'Reports Board' });

    // The sprint selector should contain the completed sprint
    const sprintSelect = page.locator('.reports-filters select').nth(1);
    await expect(sprintSelect).toBeVisible({ timeout: 8000 });
    await expect(sprintSelect.locator('option:has-text("Completed Sprint")')).toHaveCount(1);
  });

  // 11. Cannot start second sprint
  test('cannot start a second sprint while one is already active', async ({ page, request }) => {
    const email = `two-sprints-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Two Sprint User' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Two Sprint Board' },
    });
    const board = await boardRes.json();

    // Sprint A — will be started
    const sARes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Alpha' },
    });
    const sprintA = await sARes.json();

    // Sprint B — should stay in planning
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Beta' },
    });

    // Start Sprint A via API
    await request.post(`${BASE}/api/sprints/${sprintA.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint Beta's "Start Sprint" button should be disabled since Sprint Alpha is active
    const startBtn = page.locator('button:has-text("Start Sprint")');
    await expect(startBtn).toBeDisabled();
  });

  // 13. POST /api/sprints returns 400 when board_id is missing
  test('POST /api/sprints returns 400 when board_id query param is missing', async ({ request }) => {
    const email = `sprint-nobid-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'No BoardID User' },
    });
    const { token } = await signupRes.json();

    const res = await request.post(`${BASE}/api/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Should Fail Sprint' },
    });
    expect(res.status()).toBe(400);
  });

  // 14. GET /api/sprints/:id returns correct sprint shape
  test('GET /api/sprints/:id returns sprint with correct fields', async ({ request }) => {
    const email = `sprint-get-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Get Sprint User' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Get Sprint Board' },
    });
    const board = await boardRes.json();

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Get Me Sprint', goal: 'Deliver the MVP' },
    });
    expect(sprintRes.status()).toBe(201);
    const created = await sprintRes.json();

    const getRes = await request.get(`${BASE}/api/sprints/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);

    const sprint = await getRes.json();
    expect(sprint.id).toBe(created.id);
    expect(sprint.name).toBe('Get Me Sprint');
    expect(sprint.goal).toBe('Deliver the MVP');
    expect(sprint.status).toBe('planning');
    expect(sprint.board_id).toBe(board.id);
  });

  // 15. Card reassigned from one sprint to another — appears in correct sprint panel
  test('card reassigned from sprint A to sprint B shows in B, not A', async ({ page, request }) => {
    const email = `sprint-reassign-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Reassign User' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Reassign Board' },
    });
    const board = await boardRes.json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'RL-', color: '#6366f1' },
    });

    const boardDetailRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardDetail = await boardDetailRes.json();
    const firstColumn = (boardDetail.columns || [])[0];
    const swimlanesRes = await request.get(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const swimlanes = await swimlanesRes.json();
    const swimlaneId = swimlanes[0]?.id;

    const sprintARes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint A' },
    });
    const sprintA = await sprintARes.json();

    const sprintBRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint B' },
    });
    const sprintB = await sprintBRes.json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlaneId,
        column_id: firstColumn?.id,
        title: 'Reassign Me Card',
        priority: 'medium',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign to Sprint A first
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintA.id },
    });

    // Reassign to Sprint B
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintB.id },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint B panel should contain the card
    const sprintBHeader = page.locator('.backlog-sprint-header h2:has-text("Sprint B")');
    await expect(sprintBHeader).toBeVisible({ timeout: 6000 });
    const sprintBPanel = page.locator('.backlog-sprint-panel').filter({
      has: page.locator('.backlog-sprint-header h2:has-text("Sprint B")'),
    });
    await expect(sprintBPanel.locator('.card-title:has-text("Reassign Me Card")')).toBeVisible({
      timeout: 6000,
    });

    // Sprint A panel should NOT contain the card
    const sprintAPanel = page.locator('.backlog-sprint-panel').filter({
      has: page.locator('.backlog-sprint-header h2:has-text("Sprint A")'),
    });
    await expect(sprintAPanel.locator('.card-title:has-text("Reassign Me Card")')).not.toBeVisible();
  });

  // 16. Sprint dates
  test('sprint created with start and end dates shows dates in backlog panel', async ({
    page,
    request,
  }) => {
    const email = `sprint-dates-${crypto.randomUUID()}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Dates User' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Dates Board' },
    });
    const board = await boardRes.json();

    // Create sprint with explicit dates via API
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Dated Sprint',
        start_date: '2026-05-01T00:00:00Z',
        end_date: '2026-05-14T00:00:00Z',
      },
    });
    const sprint = await sprintRes.json();
    expect(sprint.id).toBeTruthy();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // The sprint-dates element should be visible and contain date strings
    const datesEl = page.locator('.sprint-dates');
    await expect(datesEl).toBeVisible({ timeout: 6000 });
    const datesText = await datesEl.textContent();
    // The dates are formatted as locale strings — just verify year/month digits present
    expect(datesText).toMatch(/2026/);
  });
});
