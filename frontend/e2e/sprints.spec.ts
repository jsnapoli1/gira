import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function setupBoard(
  request: any,
  token: string,
  boardName = 'Sprint Test Board',
): Promise<{ boardId: number; swimlaneId: number; firstColumnId: number }> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'SP-', color: '#6366f1' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  return { boardId: board.id, swimlaneId: swimlane.id, firstColumnId: firstColumn?.id };
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

// Navigate to the board and switch to backlog view
async function goToBacklog(page: any, boardId: number): Promise<void> {
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprints', () => {
  // -------------------------------------------------------------------------
  // 1. Create sprint via UI — sprint appears in backlog panel
  // -------------------------------------------------------------------------
  test('create sprint via UI — sprint appears in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Create Sprint UI Tester');
    const { boardId } = await setupBoard(request, token, 'Create Sprint Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    // The no-sprint state has a Create Sprint button; there's also one in the backlog header
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // Click "Create Sprint" — may be in the no-sprint panel or the backlog-header
    await page.click('button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    // Fill in the sprint name (placeholder is "Sprint 1")
    const nameInput = page.locator('.modal input[placeholder="Sprint 1"]');
    await nameInput.fill('My New Sprint');

    // Submit the form
    await page.click('.modal button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Sprint panel header with the new name must now be visible
    await expect(page.locator('.backlog-sprint-header')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('My New Sprint');
  });

  // -------------------------------------------------------------------------
  // 2. Create sprint with dates via UI
  // -------------------------------------------------------------------------
  test('create sprint with start and end dates via UI — sprint-dates appears', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Dated Sprint UI Tester');
    const { boardId } = await setupBoard(request, token, 'Dated Sprint UI Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    await page.click('button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    await page.locator('.modal input[placeholder="Sprint 1"]').fill('Dated Sprint');
    // Fill start and end dates
    await page.locator('.modal input[type="date"]').first().fill('2026-04-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-04-14');

    await page.click('.modal button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Dates element should now be visible in the sprint header
    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 3. Sprint created via API appears in backlog panel
  // -------------------------------------------------------------------------
  test('sprint created via API appears in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'API Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'API Sprint Board');
    await createSprint(request, token, boardId, 'API Sprint');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('API Sprint');
  });

  // -------------------------------------------------------------------------
  // 4. Sprint appears as active-sprint-badge in board header after start
  // -------------------------------------------------------------------------
  test('started sprint name appears as badge in board header', async ({ page, request }) => {
    const { token } = await createUser(request, 'Badge Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Badge Sprint Board');
    const sprint = await createSprint(request, token, boardId, 'Badge Sprint');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Active sprint badge must show the sprint name
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Badge Sprint');
  });

  // -------------------------------------------------------------------------
  // 5. Multiple sprints all appear in backlog
  // -------------------------------------------------------------------------
  test('multiple sprints all appear in backlog view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Multi Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Multi Sprint Board');

    await createSprint(request, token, boardId, 'Sprint Alpha');
    await createSprint(request, token, boardId, 'Sprint Beta');
    await createSprint(request, token, boardId, 'Sprint Gamma');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header')).toHaveCount(3);
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Alpha")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Beta")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Gamma")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 6. Sprint with no cards shows empty state in sprint panel
  // -------------------------------------------------------------------------
  test('sprint with no cards shows empty state inside sprint panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Empty Sprint Board');
    await createSprint(request, token, boardId, 'Empty Sprint');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    // The sprint cards zone shows an empty message
    await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 7. Board view shows empty columns grid when only a planning sprint exists
  // -------------------------------------------------------------------------
  test('board view shows empty columns grid when sprint is in planning status', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Planning Board Tester');
    const { boardId } = await setupBoard(request, token, 'Planning Sprint Board');
    // Create sprint but do NOT start it — status stays "planning"
    await createSprint(request, token, boardId, 'Planning Sprint');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Board resolves the planning sprint as activeSprint, shows the badge and empty columns grid.
    // The .active-sprint-badge should be present with the planning sprint name.
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Planning Sprint');
    // Column grid (board-grid) is rendered — not the empty-swimlanes fallback
    await expect(page.locator('.board-grid')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 7b. Board view shows empty state when there are no sprints at all
  // -------------------------------------------------------------------------
  test('board view shows empty state when board has swimlanes but no sprints', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Empty Board Tester');
    const { boardId } = await setupBoard(request, token, 'Empty Board No Sprints');
    // Do NOT create any sprint

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // No sprints + swimlanes present → empty-swimlanes state shown
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 8. Start sprint via UI button — sprint shows active badge
  // -------------------------------------------------------------------------
  test('start sprint via "Start Sprint" button — active status badge appears', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Start Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Start Sprint Board');
    await createSprint(request, token, boardId, 'Sprint To Start');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Click the "Start Sprint" button
    await page.click('button:has-text("Start Sprint")');

    // Active status badge must appear in the sprint header
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 9. Complete sprint — active badge disappears
  // -------------------------------------------------------------------------
  test('complete sprint — active badge disappears from backlog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Complete Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Complete Sprint Board');
    const sprint = await createSprint(request, token, boardId, 'Sprint To Complete');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the confirmation dialog before completing
    page.once('dialog', (d: any) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 10. Delete sprint via backlog trash button — sprint panel disappears
  // -------------------------------------------------------------------------
  test('delete sprint via backlog trash button — sprint panel disappears', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Delete Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Delete Sprint Board');
    await createSprint(request, token, boardId, 'Deletable Sprint');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the window.confirm() dialog before clicking delete
    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 11. Delete sprint — confirmation dialog shown (dismiss cancels deletion)
  // -------------------------------------------------------------------------
  test('dismissing delete confirmation keeps sprint in backlog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Dismiss Delete Tester');
    const { boardId } = await setupBoard(request, token, 'Dismiss Delete Board');
    await createSprint(request, token, boardId, 'Keep This Sprint');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Dismiss the confirmation dialog
    page.once('dialog', (d: any) => d.dismiss());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel should still be visible
    await expect(page.locator('.backlog-sprint-header h2:has-text("Keep This Sprint")')).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 12. Cannot start second sprint while one is active
  // -------------------------------------------------------------------------
  test('start sprint button disabled when another sprint is already active', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Two Sprints Tester');
    const { boardId } = await setupBoard(request, token, 'Two Sprints Board');

    const sprintA = await createSprint(request, token, boardId, 'Sprint A');
    await createSprint(request, token, boardId, 'Sprint B');
    await startSprint(request, token, sprintA.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint B's "Start Sprint" button should be disabled since Sprint A is running
    const startBtn = page.locator('button:has-text("Start Sprint")');
    await expect(startBtn).toBeDisabled({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 13. After completing a sprint, next sprint can be started
  // -------------------------------------------------------------------------
  test('after completing a sprint a second sprint can be started', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sequential Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Sequential Sprint Board');

    const sprint1 = await createSprint(request, token, boardId, 'Sprint One');
    await createSprint(request, token, boardId, 'Sprint Two');
    await startSprint(request, token, sprint1.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Complete Sprint One via UI
    page.once('dialog', (d: any) => d.accept());
    await page.click('button:has-text("Complete Sprint")');

    // Now Sprint Two's "Start Sprint" button should be enabled
    await expect(page.locator('button:has-text("Start Sprint")')).toBeEnabled({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 14. Sprint created with goal — goal shown in backlog panel
  // -------------------------------------------------------------------------
  test('sprint created with goal text shows goal in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sprint Goal Tester');
    const { boardId } = await setupBoard(request, token, 'Sprint Goal Board');
    await createSprint(request, token, boardId, 'Sprint With Goal', {
      goal: 'Ship the new login flow',
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page, boardId);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-goal')).toContainText('Ship the new login flow');
  });

  // -------------------------------------------------------------------------
  // 15. Sprint LIST API returns all sprints for board
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

  // -------------------------------------------------------------------------
  // 16. Completing a sprint removes sprint cards from active board view
  // -------------------------------------------------------------------------
  test('completing a sprint removes sprint cards from board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Complete Clear Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(
      request,
      token,
      'Complete Clear Board',
    );
    const sprint = await createSprint(request, token, boardId, 'Clear Sprint');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Clear Sprint Card',
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: firstColumnId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // No active sprint → empty state
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 17. PUT /api/sprints/:id updates sprint name correctly (API shape)
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id updates name and returns updated sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Update Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Update Sprint Board');
    const sprint = await createSprint(request, token, boardId, 'Old Name');

    const res = await request.put(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'New Name', goal: 'New goal' },
    });
    expect(res.status()).toBe(200);

    const updated = await res.json();
    expect(updated.name).toBe('New Name');
    expect(updated.goal).toBe('New goal');
    expect(updated.id).toBe(sprint.id);
  });

  // -------------------------------------------------------------------------
  // 18. DELETE /api/sprints/:id returns 204
  // -------------------------------------------------------------------------
  test('DELETE /api/sprints/:id returns 204 and sprint no longer listed', async ({ request }) => {
    const { token } = await createUser(request, 'Delete API Tester');
    const { boardId } = await setupBoard(request, token, 'Delete API Board');
    const sprint = await createSprint(request, token, boardId, 'Delete Me Sprint');

    const res = await request.delete(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(204);

    // Verify it's removed from list
    const listRes = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprints: Array<{ id: number }> = (await listRes.json()) ?? [];
    expect(Array.isArray(sprints)).toBe(true);
    expect(sprints.find((s) => s.id === sprint.id)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 19. Active sprint can still be deleted via API (no guard exists)
  // -------------------------------------------------------------------------
  test('active sprint can be deleted via API — board shows no active sprint after', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Delete Active Tester');
    const { boardId } = await setupBoard(request, token, 'Delete Active Board');
    const sprint = await createSprint(request, token, boardId, 'Active Sprint To Delete');
    await startSprint(request, token, sprint.id);

    // Delete the active sprint directly via API
    const delRes = await request.delete(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // With no active sprint the board shows the empty state
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 20. GET /api/sprints/:id returns 404 for non-existent sprint
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id returns 404 for a non-existent sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Sprint 404 Tester');
    const res = await request.get(`${BASE}/api/sprints/999999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 21. Completing sprint updates status in GET /api/sprints?board_id
  // -------------------------------------------------------------------------
  test('completing a sprint changes its status to completed in list endpoint', async ({ request }) => {
    const { token } = await createUser(request, 'Status Update Tester');
    const { boardId } = await setupBoard(request, token, 'Status Update Board');
    const sprint = await createSprint(request, token, boardId, 'Status Sprint');
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprints = await res.json();
    const found = sprints.find((s: { id: number; status: string }) => s.id === sprint.id);
    expect(found).toBeTruthy();
    expect(found.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // 22. Sprint edit — update goal via PUT persists to GET /api/sprints/:id
  // -------------------------------------------------------------------------
  test('updating sprint goal via PUT is reflected in GET /api/sprints/:id', async ({ request }) => {
    const { token } = await createUser(request, 'Goal Update Tester');
    const { boardId } = await setupBoard(request, token, 'Goal Update Board');
    const sprint = await createSprint(request, token, boardId, 'Goal Sprint', { goal: 'Old goal' });

    await request.put(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Goal Sprint', goal: 'Refactored goal' },
    });

    const getRes = await request.get(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await getRes.json();
    expect(updated.goal).toBe('Refactored goal');
  });
});
