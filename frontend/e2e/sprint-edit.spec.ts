import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;

interface SetupResult {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  columnId: number;
}

async function setupBoardWithSprint(request: any, sprintName = 'Sprint 1'): Promise<SetupResult> {
  const email = `test-sprint-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'SprintEdit Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Sprint Edit Board' },
  });
  const board = await boardRes.json();

  // Create a swimlane (needed for card creation)
  const swimlaneRes = await request.post(`http://localhost:${PORT}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
  });
  const swimlane = await swimlaneRes.json();

  // Get columns from board
  const boardDetailRes = await request.get(`http://localhost:${PORT}/api/boards/${board.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const boardDetail = await boardDetailRes.json();
  const firstColumn = (boardDetail.columns || [])[0];

  // Create sprint via API
  const sprintRes = await request.post(`http://localhost:${PORT}/api/sprints?board_id=${board.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: sprintName },
  });
  const sprint = await sprintRes.json();

  return {
    token,
    boardId: board.id,
    sprintId: sprint.id,
    swimlaneId: swimlane.id,
    columnId: firstColumn?.id,
  };
}

test.describe('Sprint Edit', () => {
  test('edit sprint name', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Original Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Navigate to backlog view
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Click pencil/edit button on the sprint panel
    await page.click('.backlog-sprint-header button[title="Edit sprint"]');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    // Clear name and type new name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Updated Sprint');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Verify the sprint panel header shows the new name
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Updated Sprint');
  });

  test('edit sprint goal', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Goal Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Open edit modal
    await page.click('.backlog-sprint-header button[title="Edit sprint"]');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    // Fill in goal
    const goalTextarea = page.locator('.modal textarea');
    await goalTextarea.fill('Ship the feature');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Verify goal appears in sprint panel
    await expect(page.locator('.sprint-goal')).toContainText('Ship the feature');
  });

  test('edit sprint with start and end dates', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Dated Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Open edit modal
    await page.click('.backlog-sprint-header button[title="Edit sprint"]');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    // Set dates
    await page.locator('.modal input[type="date"]').first().fill('2026-04-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-04-14');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Verify sprint dates appear in the header
    await expect(page.locator('.sprint-dates')).toBeVisible();
  });

  test('delete sprint with no cards', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Deletable Sprint');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Accept the confirm dialog before clicking delete
    page.once('dialog', (d) => d.accept());

    // Click the delete (trash) button
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel should disappear
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  test('delete sprint with cards moves cards to backlog', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Sprint With Cards',
    );

    // Create a card and assign it to the sprint
    const cardRes = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        sprint_id: null,
        title: 'Card In Sprint',
        description: '',
        priority: 'medium',
      },
    });
    const card = await cardRes.json();

    await request.post(`http://localhost:${PORT}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card should appear in sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Card In Sprint');

    // Accept dialog and delete sprint
    page.once('dialog', (d) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel should be gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });

    // Card should now appear in the backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Card In Sprint');
  });

  test('cannot start second sprint while one is active', async ({ page, request }) => {
    const email = `test-two-sprints-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'TwoSprint Tester' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Two Sprint Board' },
    });
    const board = await boardRes.json();

    // Create two sprints
    const sprint1Res = await request.post(`http://localhost:${PORT}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint A' },
    });
    const sprint1 = await sprint1Res.json();

    await request.post(`http://localhost:${PORT}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint B' },
    });

    // Start the first sprint via API
    await request.post(`http://localhost:${PORT}/api/sprints/${sprint1.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint B's "Start Sprint" button should be disabled since Sprint A is active
    // There is exactly one "Start Sprint" button visible (Sprint B's); Sprint A shows "Complete Sprint"
    const startBtn = page.locator('button:has-text("Start Sprint")');
    await expect(startBtn).toBeDisabled();
  });
});
