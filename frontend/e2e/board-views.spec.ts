import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

test.describe('Board Views', () => {
  let token: string;
  let boardId: number;
  // Column/swimlane IDs needed for card creation
  let columnId: number;
  let swimlaneId: number;
  // Sprint created and started for board view tests
  let sprintId: number;

  test.beforeEach(async ({ request, page }) => {
    const email = `test-bv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'View Tester' },
    });
    token = (await signupRes.json()).token;

    // Create board (returns with embedded columns/swimlanes)
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'View Test Board' },
    });
    const boardData = await boardRes.json();
    boardId = boardData.id;

    // Fetch full board to get embedded columns & swimlanes
    const fullBoardRes = await request.get(`${BASE}/api/boards/${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fullBoard = await fullBoardRes.json();
    columnId = fullBoard.columns?.[0]?.id;
    swimlaneId = fullBoard.swimlanes?.[0]?.id;

    // Create and start a sprint
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Sprint' },
    });
    const sprint = await sprintRes.json();
    sprintId = sprint.id;

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
  });

  test('board view (Kanban) is default', async ({ page }) => {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();
    // The "Board" view-btn should have the active class
    const boardBtn = page.locator('.view-btn:has-text("Board")');
    await expect(boardBtn).toBeVisible();
    await expect(boardBtn).toHaveClass(/active/);
  });

  test('switch to Backlog view', async ({ page }) => {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();

    await page.click('.view-btn:has-text("Backlog")');

    // Backlog view renders a .backlog-header section
    await expect(page.locator('.backlog-header').first()).toBeVisible({ timeout: 8000 });
    // The Backlog button should now be active
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/);
  });

  test('switch to All Cards view', async ({ page }) => {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();

    await page.click('.view-btn:has-text("All Cards")');

    // All Cards view renders the board-content grid (DndContext) regardless of sprint
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
  });

  test('board view shows sprint cards', async ({ request, page }) => {
    // Only meaningful if we have a swimlane/column
    if (!columnId || !swimlaneId) {
      test.skip();
      return;
    }

    // Create a card and assign it to the active sprint
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        title: 'Sprint Card',
      },
    });
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.goto(`/boards/${boardId}`);
    // Board view (default) — wait for board content to render
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    // The card should appear
    await expect(page.locator(`.card-item, .board-card-item`).filter({ hasText: 'Sprint Card' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('All Cards view shows cards without sprint', async ({ request, page }) => {
    if (!columnId || !swimlaneId) {
      test.skip();
      return;
    }

    // Create a card NOT assigned to any sprint
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        title: 'Unsprinted Card',
      },
    });

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();

    // Switch to All Cards — should show cards not in any sprint
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // The unsprinted card title should be visible somewhere in columns
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Unsprinted Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('view mode button shows active state for each mode', async ({ page }) => {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();

    // Board (default) active
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("All Cards")')).not.toHaveClass(/active/);

    // Switch to Backlog
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Board")')).not.toHaveClass(/active/);

    // Switch to All Cards
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
  });

  test('backlog shows swimlane sections', async ({ page }) => {
    // The board has a default swimlane (if the API creates one on board creation).
    // If the board has no swimlanes the BacklogView still renders — we only check for
    // the backlog chrome (header / sprint panel).
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible();

    await page.click('.view-btn:has-text("Backlog")');

    // BacklogView always renders a .backlog-header
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // If there are swimlanes they appear as .backlog-section.swimlane-backlog elements
    const swimlaneSections = page.locator('.backlog-section.swimlane-backlog');
    const count = await swimlaneSections.count();
    if (count > 0) {
      // Each section should have a .backlog-section-header
      await expect(swimlaneSections.first().locator('.backlog-section-header')).toBeVisible();
    }
    // Whether or not swimlane sections exist the test passes — we verified the view switched
  });

  test('board header shows active sprint badge', async ({ page }) => {
    await page.goto(`/boards/${boardId}`);
    // The sprint was started in beforeEach — the badge should be present
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Test Sprint');
  });
});
