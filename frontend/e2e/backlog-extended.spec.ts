import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;

interface SetupResult {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  columnId: number;
}

async function setupBoardWithSprint(request: any, sprintName = 'Backlog Sprint'): Promise<SetupResult> {
  const email = `test-backlog-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Backlog Ext Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Backlog Extended Board' },
  });
  const board = await boardRes.json();

  // Create a swimlane (needed for backlog section to render)
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

async function createCard(request: any, token: string, boardId: number, swimlaneId: number, columnId: number, title: string) {
  const cardRes = await request.post(`http://localhost:${PORT}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      sprint_id: null,
      title,
      description: '',
      priority: 'medium',
    },
  });
  return cardRes.json();
}

test.describe('Backlog Extended', () => {
  test('remove card from sprint moves it back to backlog section', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    // Create a card and assign it to the sprint
    const card = await createCard(request, token, boardId, swimlaneId, columnId, 'Removable Card');
    await request.post(`http://localhost:${PORT}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    // Start the sprint
    await request.post(`http://localhost:${PORT}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Confirm card is in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Removable Card');

    // Click the remove (✕) button on the card in the sprint
    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    // Card should move to the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Removable Card');

    // Sprint panel should now show empty
    await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible();
  });

  test('sprint card count badge shows correct count', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    // Create 2 cards and assign both to the sprint
    const card1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Card One');
    const card2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Card Two');

    await request.post(`http://localhost:${PORT}/api/cards/${card1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });
    await request.post(`http://localhost:${PORT}/api/cards/${card2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint card count badge should show "2 cards"
    await expect(page.locator('.sprint-card-count')).toContainText('2');
  });

  test('card count decreases after removing one from sprint', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    // Create 2 cards and assign both to sprint
    const card1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Keep Card');
    const card2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Remove Card');

    await request.post(`http://localhost:${PORT}/api/cards/${card1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });
    await request.post(`http://localhost:${PORT}/api/cards/${card2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Confirm count is 2
    await expect(page.locator('.sprint-card-count')).toContainText('2');

    // Remove one card from sprint
    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    // Count should now be 1
    await expect(page.locator('.sprint-card-count')).toContainText('1');
  });

  test('sprint goal is visible in backlog sprint panel', async ({ page, request }) => {
    const email = `test-sprint-goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Goal Tester' },
    });
    const { token } = await signupRes.json();

    const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Goal Test Board' },
    });
    const board = await boardRes.json();

    // Create sprint with a goal
    await request.post(`http://localhost:${PORT}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint With Goal', goal: 'My Goal' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint goal should be visible in the sprint panel
    await expect(page.locator('.sprint-goal')).toContainText('My Goal');
  });

  test('sprint dates are shown in backlog sprint panel after API update', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'Dated Sprint');

    // Update sprint with start and end dates via API
    await request.put(`http://localhost:${PORT}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Dated Sprint',
        start_date: '2026-04-01',
        end_date: '2026-04-14',
      },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint dates element should be visible in the sprint panel header
    await expect(page.locator('.sprint-dates')).toBeVisible();
  });
});
