import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  firstColumnId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Navigate to backlog view and open the edit modal for the first sprint panel.
async function openEditModal(page: any): Promise<void> {
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
  // 1. Edit sprint name
  // -------------------------------------------------------------------------
  test('edit sprint name — updated name appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Original Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    // Clear and type a new name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Updated Sprint Name');

    // Save and wait for modal to close
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // New name must be reflected in the sprint panel header
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Updated Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 2. Edit sprint goal
  // -------------------------------------------------------------------------
  test('edit sprint goal — goal text appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Goal Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    // Fill in the goal textarea
    await page.locator('.modal textarea').fill('Deliver the MVP features');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Goal element should appear and show the text
    await expect(page.locator('.sprint-goal')).toContainText('Deliver the MVP features');
  });

  // -------------------------------------------------------------------------
  // 3. Edit sprint start and end dates
  // -------------------------------------------------------------------------
  test('edit sprint start and end dates — .sprint-dates element becomes visible', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Dated Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    // Set start and end dates in the date inputs
    await page.locator('.modal input[type="date"]').first().fill('2026-05-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-05-14');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // The sprint-dates element must now be visible and contain the year
    const datesEl = page.locator('.sprint-dates');
    await expect(datesEl).toBeVisible({ timeout: 6000 });
    await expect(datesEl).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 4. Sprint name update persists after page reload
  // -------------------------------------------------------------------------
  test('sprint name change persists after page reload', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Persist Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Persisted Sprint Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Hard reload the page
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Name should survive the reload
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Persisted Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 5. Delete sprint with no cards
  // -------------------------------------------------------------------------
  test('delete sprint with no cards — sprint panel disappears', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Deletable Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the confirm dialog before clicking delete
    page.once('dialog', (d) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel should be gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 6. Delete sprint with cards moves cards back to backlog
  // -------------------------------------------------------------------------
  test('deleting sprint with cards moves those cards back to swimlane backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } = await setupBoardWithSprint(
      request,
      'Sprint With Cards',
    );

    // Create a card and assign it to the sprint
    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          board_id: boardId,
          swimlane_id: swimlaneId,
          column_id: firstColumnId,
          title: 'Card In Sprint',
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card must be in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Card In Sprint');

    // Delete the sprint
    page.once('dialog', (d) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });

    // Card must now appear in the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Card In Sprint');
  });

  // -------------------------------------------------------------------------
  // 7. Cannot start second sprint while one is active
  // -------------------------------------------------------------------------
  test('start sprint button disabled when another sprint is already active', async ({
    page,
    request,
  }) => {
    const email = `test-two-sprints-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'TwoSprint Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Two Sprint Board' },
      })
    ).json();

    // Create Sprint A and Sprint B
    const sprint1 = await (
      await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Sprint A' },
      })
    ).json();

    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint B' },
    });

    // Start Sprint A via API
    await request.post(`${BASE}/api/sprints/${sprint1.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint B's "Start Sprint" button should be disabled
    const startBtn = page.locator('button:has-text("Start Sprint")');
    await expect(startBtn).toBeDisabled({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 8. Sprint PUT API — update persists via direct API round-trip
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id updates name, goal, and dates', async ({ request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'API Update Sprint');

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

    // Re-fetch the sprint and verify all fields
    const getRes = await request.get(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const sprint = await getRes.json();

    expect(sprint.name).toBe('Renamed via API');
    expect(sprint.goal).toBe('API goal text');
    // Start/end date may be returned as ISO string — just check the date prefix
    expect(sprint.start_date).toMatch(/2026-06-01/);
    expect(sprint.end_date).toMatch(/2026-06-14/);
  });

  // -------------------------------------------------------------------------
  // 9. Cancel edit modal — name stays unchanged
  // -------------------------------------------------------------------------
  test('cancelling the edit sprint modal leaves the sprint name unchanged', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Cancel Edit Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    // Type a different name but cancel instead of saving
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Should Not Save');

    // Click the Cancel button (or close button — look for btn-secondary or "Cancel" text)
    const cancelBtn = page.locator('.modal button:has-text("Cancel"), .modal .btn-secondary:has-text("Cancel")').first();
    await cancelBtn.click();
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Original name should still be shown
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Cancel Edit Sprint');
  });

  // -------------------------------------------------------------------------
  // 10. Edit modal pre-populates existing sprint name
  // -------------------------------------------------------------------------
  test('edit sprint modal pre-populates existing sprint name in input', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Pre-Populated Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await openEditModal(page);

    // The name input should already contain the current sprint name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await expect(nameInput).toHaveValue('Pre-Populated Sprint');
  });
});
