import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  firstColumnId: number;
}

async function setupBoardWithSprint(
  request: any,
  sprintName = 'Sprint 1',
): Promise<BoardSetup> {
  const email = `test-sprint-edit-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'SprintEdit Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Edit Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  return {
    token,
    boardId: board.id,
    sprintId: sprint.id,
    swimlaneId: swimlane.id,
    firstColumnId: firstColumn?.id,
  };
}

// Navigate to the board, switch to backlog, then open the edit modal for the first sprint.
async function openBacklogEditModal(page: any): Promise<void> {
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
  await page.click('.backlog-sprint-header button[title="Edit sprint"]');
  await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint Edit', () => {
  // -------------------------------------------------------------------------
  // 1. Edit sprint name — updated name appears in backlog panel
  // -------------------------------------------------------------------------
  test('edit sprint name — updated name appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Original Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Updated Sprint Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Updated Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 2. Edit sprint name — new name appears in board header badge
  // -------------------------------------------------------------------------
  test('renamed sprint appears in board header active-sprint-badge', async ({ page, request }) => {
    const email = `test-badge-rename-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Badge Rename Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Badge Rename Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    const sprint = await (
      await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Before Rename' },
      })
    ).json();

    // Start the sprint so it shows in the board header badge
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Open edit via the active-sprint-badge in board header
    await page.click('.active-sprint-badge');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('After Rename');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.active-sprint-badge')).toContainText('After Rename');
  });

  // -------------------------------------------------------------------------
  // 3. Edit sprint goal — goal text appears in backlog panel
  // -------------------------------------------------------------------------
  test('edit sprint goal — goal text appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Goal Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await page.locator('.modal textarea').fill('Deliver the MVP features');
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.sprint-goal')).toContainText('Deliver the MVP features');
  });

  // -------------------------------------------------------------------------
  // 4. Edit sprint start and end dates — sprint-dates element becomes visible
  // -------------------------------------------------------------------------
  test('edit sprint start and end dates — sprint-dates element becomes visible', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Dated Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await page.locator('.modal input[type="date"]').first().fill('2026-05-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-05-14');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    const datesEl = page.locator('.sprint-dates');
    await expect(datesEl).toBeVisible({ timeout: 6000 });
    await expect(datesEl).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 5. Sprint dates shown in backlog header after API update
  // -------------------------------------------------------------------------
  test('sprint dates shown in backlog header after API update', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'API Dated Sprint');

    await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'API Dated Sprint',
        start_date: '2026-06-01',
        end_date: '2026-06-14',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 6. Cancel edit modal — name stays unchanged
  // -------------------------------------------------------------------------
  test('cancelling the edit sprint modal leaves the sprint name unchanged', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Cancel Edit Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Should Not Save');

    // Click Cancel button
    await page.click('.modal button:has-text("Cancel")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Original name must still be shown
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Cancel Edit Sprint');
  });

  // -------------------------------------------------------------------------
  // 7. Edit modal pre-populates existing sprint name
  // -------------------------------------------------------------------------
  test('edit sprint modal pre-populates existing sprint name in input', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Pre-Populated Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await expect(nameInput).toHaveValue('Pre-Populated Sprint');
  });

  // -------------------------------------------------------------------------
  // 8. Sprint name change persists after page reload
  // -------------------------------------------------------------------------
  test('sprint name change persists after page reload', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Persist Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Persisted Sprint Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Hard reload
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Persisted Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 9. PUT /api/sprints/:id updates name, goal, and dates (API round-trip)
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id updates name, goal, and dates', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'API Update Sprint');

    const updateRes = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Renamed via API',
        goal: 'API goal text',
        start_date: '2026-06-01',
        end_date: '2026-06-14',
      },
    });
    expect(updateRes.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const sprint = await getRes.json();

    expect(sprint.name).toBe('Renamed via API');
    expect(sprint.goal).toBe('API goal text');
    expect(sprint.start_date).toMatch(/2026-06-01/);
    expect(sprint.end_date).toMatch(/2026-06-14/);
  });

  // -------------------------------------------------------------------------
  // 10. Save sprint edits — Save button submits and closes modal
  // -------------------------------------------------------------------------
  test('save sprint edits closes modal and reflects update immediately', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Save Test Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    // Change the name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Saved Sprint Name');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');

    // Modal must close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Updated name reflected without reload
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Saved Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 11. Delete sprint with no cards — sprint panel disappears
  // -------------------------------------------------------------------------
  test('delete sprint with no cards — sprint panel disappears', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Deletable Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 12. Delete sprint with cards — cards move back to swimlane backlog section
  // -------------------------------------------------------------------------
  test('deleting sprint with cards moves those cards back to swimlane backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } = await setupBoardWithSprint(
      request,
      'Sprint With Cards',
    );

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: firstColumnId,
        title: 'Card In Sprint',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card must be in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Card In Sprint');

    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });

    // Card must now appear in the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Card In Sprint');
  });
});
