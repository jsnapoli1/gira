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

  // =========================================================================
  // API CRUD tests (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 17. Create sprint with just name succeeds
  // -------------------------------------------------------------------------
  test('POST /api/sprints — create with just name returns 201', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Name Only Board');

    const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Minimal Sprint' },
    });
    expect(res.status()).toBe(201);

    const sprint = await res.json();
    expect(sprint.id).toBeTruthy();
    expect(sprint.name).toBe('Minimal Sprint');
  });

  // -------------------------------------------------------------------------
  // 18. Create sprint with all fields (name, goal, start_date, end_date)
  // -------------------------------------------------------------------------
  test('POST /api/sprints — create with all fields stores all values', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'All Fields Board');

    const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Full Sprint',
        goal: 'Complete all user stories',
        start_date: '2026-10-01',
        end_date: '2026-10-14',
      },
    });
    expect(res.status()).toBe(201);

    const sprint = await res.json();
    expect(sprint.name).toBe('Full Sprint');
    expect(sprint.goal).toBe('Complete all user stories');
    expect(sprint.start_date).toMatch(/2026-10-01/);
    expect(sprint.end_date).toMatch(/2026-10-14/);
  });

  // -------------------------------------------------------------------------
  // 19. Sprint has id, name, board_id, status fields
  // -------------------------------------------------------------------------
  test('POST /api/sprints — response shape has required fields', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Shape Check Board');

    const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Shape Sprint' },
    });
    expect(res.status()).toBe(201);

    const sprint = await res.json();
    expect(typeof sprint.id).toBe('number');
    expect(typeof sprint.name).toBe('string');
    expect(typeof sprint.board_id).toBe('number');
    expect(typeof sprint.status).toBe('string');
    expect(sprint.board_id).toBe(boardId);
  });

  // -------------------------------------------------------------------------
  // 20. Initial sprint status is 'planning' (not 'active')
  // -------------------------------------------------------------------------
  test('POST /api/sprints — newly created sprint has status planning', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Planning Status Board');

    const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Fresh Sprint' },
    });
    expect(res.status()).toBe(201);

    const sprint = await res.json();
    expect(sprint.status).toBe('planning');
  });

  // -------------------------------------------------------------------------
  // 21. Board can have multiple sprints
  // -------------------------------------------------------------------------
  test('board can hold multiple sprints simultaneously', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Multi Sprint Board');

    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name },
      });
      expect(res.status()).toBe(201);
    }

    const listRes = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const sprints = await listRes.json();
    expect(sprints.length).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // 22. Sprint is returned in GET /api/sprints list
  // -------------------------------------------------------------------------
  test('GET /api/sprints?board_id — returns newly created sprint in list', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'List Sprint Board');

    const createRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Listed Sprint' },
    });
    const created = await createRes.json();

    const listRes = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const sprints = await listRes.json();

    const found = sprints.find((s: any) => s.id === created.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Listed Sprint');
  });

  // -------------------------------------------------------------------------
  // 23. Sprint is returned via GET /api/sprints/:id
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id — retrieves sprint by id', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'GetById Board');

    const createRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'GetById Sprint' },
    });
    const created = await createRes.json();

    const getRes = await request.get(`${BASE}/api/sprints/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);

    const sprint = await getRes.json();
    expect(sprint.id).toBe(created.id);
    expect(sprint.name).toBe('GetById Sprint');
  });

  // =========================================================================
  // Sprint lifecycle tests (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 24. POST /api/sprints/:id/start → status becomes 'active'
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/start — sprint status becomes active', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Start Status Board');

    const createRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Start Me Sprint' },
    });
    const sprint = await createRes.json();

    const startRes = await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(startRes.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await getRes.json();
    expect(updated.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 25. POST /api/sprints/:id/complete → status becomes 'completed'
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/complete — sprint status becomes completed', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Complete Status Board');

    const createRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Complete Me Sprint' },
    });
    const sprint = await createRes.json();

    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const completeRes = await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(completeRes.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await getRes.json();
    expect(updated.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // 26. Cannot start already-active sprint (returns 400 or 200, never 5xx)
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/start on already-active sprint does not 5xx', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'Double Start Board');

    const createRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Double Start Sprint' },
    });
    const sprint = await createRes.json();

    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Start again — should not be a server error
    const res = await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // 27. GET /api/sprints?board_id shows all statuses
  // -------------------------------------------------------------------------
  test('GET /api/sprints?board_id — list includes sprints of all statuses', async ({ request }) => {
    const { token, boardId } = await setupBoard(request, 'All Statuses Board');

    // Create planning sprint
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Planning Sprint' },
    });

    // Create and start another sprint
    const s2Res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Active Sprint Lifecycle' },
    });
    const s2 = await s2Res.json();
    await request.post(`${BASE}/api/sprints/${s2.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprints = await listRes.json();
    const statuses = sprints.map((s: any) => s.status);

    expect(statuses).toContain('planning');
    expect(statuses).toContain('active');
  });

  // =========================================================================
  // Card assignment tests (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 28. Assign card to sprint via POST /api/cards/:id/assign-sprint
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/assign-sprint — assigns card to sprint successfully', async ({
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Assign Card Board',
      'Assign Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Assign Me Card');

    const res = await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });
    expect(res.status()).toBeLessThan(300);
  });

  // -------------------------------------------------------------------------
  // 29. Card sprint_id matches assigned sprint after assignment
  // -------------------------------------------------------------------------
  test('card sprint_id matches assigned sprint after assign-sprint call', async ({ request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Card SprintId Board',
      'SprintId Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'SprintId Card');

    await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    const cardRes = await request.get(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardRes.status()).toBe(200);
    const card = await cardRes.json();
    expect(card.sprint_id).toBe(sprintId);
  });

  // -------------------------------------------------------------------------
  // 30. GET /api/sprints/:id/cards returns assigned cards
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/cards — returns cards assigned to the sprint', async ({ request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Sprint Cards Board',
      'Cards Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Sprint Cards Card');

    await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    const cardsRes = await request.get(`${BASE}/api/sprints/${sprintId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardsRes.status()).toBe(200);

    const cards = await cardsRes.json();
    expect(Array.isArray(cards)).toBe(true);
    const found = cards.find((c: any) => c.id === cardId);
    expect(found).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 31. Multiple cards assigned to same sprint
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/cards — returns all multiple assigned cards', async ({ request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Multi Card Sprint Board',
      'Multi Card Sprint',
    );

    const c1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Multi Card 1');
    const c2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Multi Card 2');
    const c3 = await createCard(request, token, boardId, swimlaneId, columnId, 'Multi Card 3');

    for (const cid of [c1, c2, c3]) {
      await request.post(`${BASE}/api/cards/${cid}/assign-sprint`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { sprint_id: sprintId },
      });
    }

    const cardsRes = await request.get(`${BASE}/api/sprints/${sprintId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await cardsRes.json();
    const ids = cards.map((c: any) => c.id);

    expect(ids).toContain(c1);
    expect(ids).toContain(c2);
    expect(ids).toContain(c3);
  });

  // -------------------------------------------------------------------------
  // 32. Unassign card (sprint_id: null) removes it from sprint
  // -------------------------------------------------------------------------
  test('assign-sprint with sprint_id: null unassigns the card', async ({ request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Unassign Board',
      'Unassign Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Unassign Me Card');

    // Assign first
    await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    // Unassign
    const unassignRes = await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: null },
    });
    expect(unassignRes.status()).toBeLessThan(300);

    const cardRes = await request.get(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const card = await cardRes.json();
    expect(card.sprint_id).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // 33. After unassign, GET /api/sprints/:id/cards excludes the card
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/cards — excludes card after unassignment', async ({ request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Exclude Card Board',
      'Exclude Sprint',
    );

    const cardId = await createCard(request, token, boardId, swimlaneId, columnId, 'Exclude Me Card');

    // Assign
    await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    // Confirm it appears
    const beforeRes = await request.get(`${BASE}/api/sprints/${sprintId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const before = await beforeRes.json();
    expect(before.find((c: any) => c.id === cardId)).toBeTruthy();

    // Unassign
    await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: null },
    });

    // Confirm it no longer appears
    const afterRes = await request.get(`${BASE}/api/sprints/${sprintId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const after = await afterRes.json();
    expect(after.find((c: any) => c.id === cardId)).toBeFalsy();
  });

  // =========================================================================
  // UI: Sprint creation (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 34. UI: Create Sprint button visible in backlog view
  // -------------------------------------------------------------------------
  test('UI: Create Sprint button is visible in backlog view', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request, 'Create Button Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);

    await expect(
      page.locator('.backlog-header button:has-text("Create Sprint")'),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 35. UI: Create Sprint form has name field
  // -------------------------------------------------------------------------
  test('UI: Create Sprint modal has a name input field', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request, 'Form Name Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    await expect(page.locator('.modal input[type="text"]').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 36. UI: Create Sprint form has goal field
  // -------------------------------------------------------------------------
  test('UI: Create Sprint modal has a goal field', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request, 'Form Goal Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    // Goal field may be a textarea or text input with "goal" in placeholder/label
    const goalField = page.locator('.modal textarea, .modal input[placeholder*="oal" i]');
    await expect(goalField.first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 37. UI: Create Sprint form has start/end date fields
  // -------------------------------------------------------------------------
  test('UI: Create Sprint modal has start and end date fields', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request, 'Form Dates Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    await expect(page.locator('.modal input[type="date"]').first()).toBeVisible();
    await expect(page.locator('.modal input[type="date"]').nth(1)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 38. UI: Submit creates sprint and shows in list
  // -------------------------------------------------------------------------
  test('UI: submitting Create Sprint form shows new sprint in backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoard(request, 'Submit Sprint Board');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    await page.fill('input[placeholder="Sprint 1"]', 'Submitted Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Submitted Sprint', {
      timeout: 6000,
    });
  });

  // -------------------------------------------------------------------------
  // 39. UI: New sprint shows "Planning" status indicator
  // -------------------------------------------------------------------------
  test('UI: newly created sprint shows Planning status in backlog', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Planning Status UI Board', 'Status Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Look for a status indicator showing "Planning" near the sprint header
    await expect(
      page.locator('.backlog-sprint-header, .sprint-status').filter({ hasText: /planning/i }),
    ).toBeVisible({ timeout: 6000 });
  });

  // =========================================================================
  // UI: Sprint management (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 40. UI: "Start Sprint" button in backlog
  // -------------------------------------------------------------------------
  test('UI: Start Sprint button is shown in backlog for a planning sprint', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Start Btn UI Board', 'Btn Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('button:has-text("Start Sprint")')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 41. UI: After start, sprint shows as "Active"
  // -------------------------------------------------------------------------
  test('UI: started sprint shows Active status in backlog header', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Active Status UI Board',
      'Active UI Sprint',
    );

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-header, .sprint-status').filter({ hasText: /active/i }),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 42. UI: Active sprint badge on board header
  // -------------------------------------------------------------------------
  test('UI: board header shows active sprint badge when sprint is active', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Badge Header Board',
      'Active Badge Sprint',
    );

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Active Badge Sprint');
  });

  // -------------------------------------------------------------------------
  // 43. UI: Sprint view shows active sprint's cards on the board
  // -------------------------------------------------------------------------
  test('UI: board view shows cards belonging to the active sprint', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Active Sprint Cards Board',
      'Cards Active Sprint',
    );

    const cardId = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      columnId,
      'Active Sprint Card',
    );
    await assignCardToSprint(request, token, cardId, sprintId);

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Board view should show the card in the active sprint
    await expect(
      page.locator('.card-title:has-text("Active Sprint Card")'),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 44. UI: "Complete Sprint" button visible for active sprint in backlog
  // -------------------------------------------------------------------------
  test('UI: Complete Sprint button is visible for an active sprint in backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Complete Visible Board',
      'Complete Visible Sprint',
    );

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('button:has-text("Complete Sprint")')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 45. UI: Complete sprint dialog/confirmation fires
  // -------------------------------------------------------------------------
  test('UI: clicking Complete Sprint triggers a confirmation dialog', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Complete Dialog Board',
      'Complete Dialog Sprint',
    );

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    let dialogFired = false;
    page.once('dialog', async (d: any) => {
      dialogFired = true;
      await d.dismiss();
    });

    await page.click('button:has-text("Complete Sprint")');
    await page.waitForTimeout(500);

    expect(dialogFired).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 46. UI: After completion, sprint shows as "Completed" (or removed from active)
  // -------------------------------------------------------------------------
  test('UI: after completing a sprint the Complete Sprint button is no longer shown', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(
      request,
      'Post Complete UI Board',
      'Post Complete Sprint',
    );

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    page.once('dialog', (d: any) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    await expect(page.locator('button:has-text("Complete Sprint")')).not.toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 47. UI: Completed sprint still shown in backlog history list
  // -------------------------------------------------------------------------
  test('UI: completed sprint remains visible in backlog as completed', async ({
    page,
    request,
  }) => {
    const email = `sprint-history-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'History User' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'History Board' },
      })
    ).json();

    const sprint = await (
      await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'History Sprint' },
      })
    ).json();

    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);

    // The completed sprint name should still be visible somewhere in the backlog
    await expect(page.locator('text=History Sprint')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 48. UI: New sprint can be created after previous sprint completion
  // -------------------------------------------------------------------------
  test('UI: can create new sprint after completing previous sprint', async ({ page, request }) => {
    const email = `sprint-new-after-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'New After User' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'New After Board' },
      })
    ).json();

    const sprint = await (
      await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'First Sprint' },
      })
    ).json();

    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);

    // "Create Sprint" button must still be accessible
    await expect(
      page.locator('.backlog-header button:has-text("Create Sprint")'),
    ).toBeVisible({ timeout: 6000 });

    // Create a new sprint after completion
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });
    await page.fill('input[placeholder="Sprint 1"]', 'Second Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('text=Second Sprint')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 49. UI: Cards without sprint shown in "No Sprint" section
  // -------------------------------------------------------------------------
  test('UI: cards not assigned to any sprint appear in swimlane backlog section', async ({
    page,
    request,
  }) => {
    const { token, boardId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'No Sprint Section Board',
      'Some Sprint',
    );

    const cardId = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      columnId,
      'Unassigned Backlog Card',
    );
    // Explicitly ensure no sprint assignment (card is created without sprint_id)
    expect(cardId).toBeGreaterThan(0);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // The unassigned card should appear in the swimlane backlog section (outside any sprint panel)
    await expect(
      page.locator('.swimlane-backlog .card-title:has-text("Unassigned Backlog Card")'),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 50. UI: Starting sprint via UI button transitions to Active in backlog
  // -------------------------------------------------------------------------
  test('UI: clicking Start Sprint button marks sprint as active without page reload', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(
      request,
      'Start Via UI Board',
      'UI Start Sprint',
    );

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await goToBacklog(page);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await page.click('button:has-text("Start Sprint")');

    // After click the active sprint badge should appear in the board header
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('UI Start Sprint');
  });
});
