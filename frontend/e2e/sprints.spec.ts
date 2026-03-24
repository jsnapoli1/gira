import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName = 'Sprint Tester'): Promise<{ token: string }> {
  const email = `test-sprints-${crypto.randomUUID()}@test.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(request: any, token: string, boardName = 'Sprint Test Board'): Promise<BoardSetup> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TEAM-', color: '#6366f1' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: firstColumn?.id,
  };
}

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
  extra: Record<string, string> = {},
): Promise<{ id: number; name: string; status: string }> {
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

test.describe('Sprints', () => {
  // -------------------------------------------------------------------------
  // 1. Create sprint via UI backlog "Create Sprint" button
  // -------------------------------------------------------------------------
  test('create sprint via UI — sprint appears in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Create Sprint UI Tester');
    const { boardId } = await setupBoard(request, token, 'Create Sprint Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Switch to backlog view
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // Open the create sprint modal
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    // Fill in name and submit
    await page.fill('input[placeholder="Sprint 1"]', 'My New Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Sprint panel should appear with the new sprint name
    await expect(page.locator('.backlog-sprint-header')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('My New Sprint');
  });

  // -------------------------------------------------------------------------
  // 2. Sprint appears in board view selector
  // -------------------------------------------------------------------------
  test('sprint created via API appears in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'API Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'API Sprint Board');
    await createSprint(request, token, boardId, 'API Sprint');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('API Sprint');
  });

  // -------------------------------------------------------------------------
  // 3. Delete sprint via backlog delete button
  // -------------------------------------------------------------------------
  test('delete sprint via backlog trash button — sprint panel disappears', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Delete Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Delete Sprint Board');
    await createSprint(request, token, boardId, 'Deletable Sprint');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the window.confirm() dialog before clicking delete
    page.once('dialog', (d) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel should be gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 4. Create multiple sprints — all appear in backlog
  // -------------------------------------------------------------------------
  test('multiple sprints all appear in backlog view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Multi Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Multi Sprint Board');

    await createSprint(request, token, boardId, 'Sprint Alpha');
    await createSprint(request, token, boardId, 'Sprint Beta');
    await createSprint(request, token, boardId, 'Sprint Gamma');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // All three sprint headers must be visible
    await expect(page.locator('.backlog-sprint-header')).toHaveCount(3);
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Alpha")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Beta")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Gamma")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Activate/start a sprint
  // -------------------------------------------------------------------------
  test('start sprint via "Start Sprint" button — sprint shows active badge', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Start Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Start Sprint Board');
    await createSprint(request, token, boardId, 'Sprint To Start');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Click the "Start Sprint" button
    await page.click('button:has-text("Start Sprint")');

    // Sprint should now display an active status badge
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 6. Complete/close a sprint
  // -------------------------------------------------------------------------
  test('complete sprint — active badge disappears from backlog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Complete Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Complete Sprint Board');
    const sprint = await createSprint(request, token, boardId, 'Sprint To Complete');

    // Start the sprint via API so UI shows "Complete Sprint"
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the confirmation dialog and complete the sprint
    page.once('dialog', (d) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    // Active badge must disappear after completion
    await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 7. Board shows empty state with no active sprint
  // -------------------------------------------------------------------------
  test('board view shows empty state when no sprint is active', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Board Tester');
    const { boardId } = await setupBoard(request, token, 'Empty Active Sprint Board');

    // Create sprint but do NOT start it
    await createSprint(request, token, boardId, 'Planning Sprint');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // The default board view with no active sprint should show the empty state
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 8. Cannot start second sprint while one is active
  // -------------------------------------------------------------------------
  test('start sprint button for second sprint is disabled when one is already active', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Two Sprints Tester');
    const { boardId } = await setupBoard(request, token, 'Two Sprints Board');

    const sprintA = await createSprint(request, token, boardId, 'Sprint A');
    await createSprint(request, token, boardId, 'Sprint B');

    // Start Sprint A via API
    await startSprint(request, token, sprintA.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint B's "Start Sprint" button should be disabled since Sprint A is running
    const startBtn = page.locator('button:has-text("Start Sprint")');
    await expect(startBtn).toBeDisabled({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 9. After completing a sprint, next sprint can be started
  // -------------------------------------------------------------------------
  test('after completing a sprint a second sprint can be started', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sequential Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Sequential Sprint Board');

    const sprint1 = await createSprint(request, token, boardId, 'Sprint One');
    await createSprint(request, token, boardId, 'Sprint Two');

    // Start then complete Sprint One via API
    await startSprint(request, token, sprint1.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Complete Sprint One via UI
    page.once('dialog', (d) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    // Now Sprint Two's "Start Sprint" should be enabled
    await expect(page.locator('button:has-text("Start Sprint")')).toBeEnabled({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 10. Sprint created with goal — goal shown in backlog
  // -------------------------------------------------------------------------
  test('sprint created with goal text shows goal in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sprint Goal Tester');
    const { boardId } = await setupBoard(request, token, 'Sprint Goal Board');
    await createSprint(request, token, boardId, 'Sprint With Goal', {
      goal: 'Ship the new login flow',
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-goal')).toContainText('Ship the new login flow');
  });

  // -------------------------------------------------------------------------
  // 11. Completed sprint no longer shown as active on board
  // -------------------------------------------------------------------------
  test('completing a sprint removes sprint cards from board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Complete Clear Tester');
    const bs = await setupBoard(request, token, 'Complete Clear Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Clear Sprint');

    // Assign a card and start
    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Clear Sprint Card',
          board_id: bs.boardId,
          swimlane_id: bs.swimlaneId,
          column_id: bs.firstColumnId,
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // No active sprint → board shows empty state
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.card-item[aria-label="Clear Sprint Card"]'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 12. Sprint LIST API returns all sprints for board
  // -------------------------------------------------------------------------
  test('GET /api/sprints?board_id returns all sprints for the board', async ({ request }) => {
    const { token } = await createUser(request, 'List API Tester');
    const { boardId } = await setupBoard(request, token, 'List API Board');

    await createSprint(request, token, boardId, 'Sprint X');
    await createSprint(request, token, boardId, 'Sprint Y');

    const res = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const sprints = await res.json();
    expect(Array.isArray(sprints)).toBe(true);
    expect(sprints.length).toBe(2);
    const names = sprints.map((s: { name: string }) => s.name);
    expect(names).toContain('Sprint X');
    expect(names).toContain('Sprint Y');
  });
});
