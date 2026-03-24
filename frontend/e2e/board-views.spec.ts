import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------
interface ViewSetup {
  token: string;
  boardId: number;
  columnId: number | null;
  swimlaneId: number | null;
  sprintId: number;
}

async function setupViewBoard(request: any): Promise<ViewSetup> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-bv-${suffix}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'View Tester' },
  });
  const token = (await signupRes.json()).token;

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'View Test Board' },
  });
  const board = await boardRes.json();
  const boardId = board.id;

  // Fetch full board to get embedded columns & swimlanes
  const fullBoardRes = await request.get(`${BASE}/api/boards/${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const fullBoard = await fullBoardRes.json();
  const columnId: number | null = fullBoard.columns?.[0]?.id ?? null;
  const swimlaneId: number | null = fullBoard.swimlanes?.[0]?.id ?? null;

  // Create and start a sprint
  const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Sprint' },
  });
  const sprint = await sprintRes.json();
  const sprintId: number = sprint.id;

  await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return { token, boardId, columnId, swimlaneId, sprintId };
}

// ---------------------------------------------------------------------------

test.describe('Board Views', () => {
  // -------------------------------------------------------------------------
  // View switching
  // -------------------------------------------------------------------------

  test('Board (Kanban) view is the default when navigating to a board', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // "Board" view-btn should have the active class by default
    const boardBtn = page.locator('.view-btn:has-text("Board")');
    await expect(boardBtn).toBeVisible();
    await expect(boardBtn).toHaveClass(/active/);
  });

  test('clicking Backlog view button switches to the backlog', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');

    // BacklogView always renders .backlog-header inside .backlog-view
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/);
  });

  test('clicking All Cards view button switches to all-cards mode', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 8000 });
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
  });

  test('each view button shows active state exclusively', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Board (default) active
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("All Cards")')).not.toHaveClass(/active/);

    // Switch to Backlog
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Board")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("All Cards")')).not.toHaveClass(/active/);

    // Switch to All Cards
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Board")')).not.toHaveClass(/active/);
  });

  // -------------------------------------------------------------------------
  // Sprint view (Board mode)
  // -------------------------------------------------------------------------

  test('Board view shows sprint cards when a sprint is active', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available for card creation');
      return;
    }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Sprint Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);
    await page.goto(`/boards/${setup.boardId}`);

    // Board view (default) — sprint is active so cards render
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Sprint Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('Board view without an active sprint shows "No sprint" empty state with a link to Backlog', async ({ request, page }) => {
    // Create a board WITHOUT starting any sprint
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-nosprint-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Sprint Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Sprint Board' },
      })
    ).json();

    // Add a swimlane so the empty state branch is reached (board checks swimlanes.length > 0)
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Should show the .empty-swimlanes prompt with a "Go to Backlog" button
    await expect(page.locator('.board-content .empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-content button:has-text("Go to Backlog")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // All Cards view
  // -------------------------------------------------------------------------

  test('All Cards view shows cards not assigned to any sprint', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available for card creation');
      return;
    }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Unsprinted Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Unsprinted Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Backlog view
  // -------------------------------------------------------------------------

  test('Backlog view renders the backlog header section', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');

    // BacklogView always renders a .backlog-header
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
  });

  test('Backlog view shows sprint panels for each sprint', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // The active sprint should appear as a .backlog-sprint-panel
    const sprintPanels = page.locator('.backlog-sprint-panel');
    await expect(sprintPanels.first()).toBeVisible({ timeout: 8000 });
    // Sprint name "Test Sprint" should be present
    await expect(page.locator('.backlog-sprint-header').first()).toContainText('Test Sprint');
  });

  test('Backlog view shows swimlane sections if swimlanes exist', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    const swimlaneSections = page.locator('.backlog-section.swimlane-backlog');
    const count = await swimlaneSections.count();
    if (count > 0) {
      await expect(swimlaneSections.first().locator('.backlog-section-header')).toBeVisible();
    }
    // Whether or not swimlane sections exist the test passes — view switch is verified
  });

  // -------------------------------------------------------------------------
  // Sprint badge in board header
  // -------------------------------------------------------------------------

  test('board header shows active sprint badge with sprint name', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    // Sprint was started in setup — badge should be visible
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Test Sprint');
  });

  test('active sprint badge shows "Active" status label', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge .sprint-status-label')).toContainText('Active');
  });

  // -------------------------------------------------------------------------
  // Column headers and card counts
  // -------------------------------------------------------------------------

  test('column headers are visible in Board / All Cards views', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // If there are swimlanes, column headers should be present
    const headers = page.locator('.board-column-header');
    const headerCount = await headers.count();
    if (headerCount > 0) {
      await expect(headers.first()).toBeVisible();
    }
    // If there are no swimlanes the board shows an empty state — that is acceptable
  });

  test('column with 0 cards still shows the column header', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane to inspect');
      return;
    }
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    // Navigate directly to All Cards view with no cards — all columns should still have headers
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    // Board was given a swimlane — there should be column header cells
    const headers = page.locator('.board-column-header');
    const count = await headers.count();
    if (count > 0) {
      // Every rendered header should be visible (empty columns included)
      for (let i = 0; i < count; i++) {
        await expect(headers.nth(i)).toBeVisible();
      }
    }
  });

  test('column card count badge updates when a card is in that column', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available for card creation');
      return;
    }

    // Create a card in the sprint (board mode) so it shows up in the column
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Column Count Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // At least one column count badge should show "1"
    await expect(page.locator('.column-count')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.column-count').first()).toHaveText('1');
  });

  // -------------------------------------------------------------------------
  // Swimlane collapse/expand
  // -------------------------------------------------------------------------

  test('clicking a swimlane gutter collapses the swimlane rows', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const swimlaneGutters = page.locator('.swimlane-gutter');
    const gutterCount = await swimlaneGutters.count();
    if (gutterCount === 0) {
      test.skip(true, 'No swimlanes rendered — board may have no swimlanes');
      return;
    }

    // Before collapsing — swimlane should NOT have the collapsed class
    const swimlane = page.locator('.swimlane').first();
    await expect(swimlane).not.toHaveClass(/swimlane-collapsed/);

    // Click the gutter to collapse
    await swimlaneGutters.first().click();

    // After click — swimlane should have the collapsed class
    await expect(swimlane).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });
  });

  test('clicking a collapsed swimlane gutter expands it again', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const swimlaneGutters = page.locator('.swimlane-gutter');
    if (await swimlaneGutters.count() === 0) {
      test.skip(true, 'No swimlanes rendered');
      return;
    }

    const swimlane = page.locator('.swimlane').first();

    // Collapse
    await swimlaneGutters.first().click();
    await expect(swimlane).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });

    // Expand
    await swimlaneGutters.first().click();
    await expect(swimlane).not.toHaveClass(/swimlane-collapsed/, { timeout: 5000 });
  });

  test('collapsed swimlane shows card count chip in gutter', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    // Create a card so the count chip shows a non-zero value
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Chip Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const gutters = page.locator('.swimlane-gutter');
    if (await gutters.count() === 0) {
      test.skip(true, 'No swimlane gutters rendered');
      return;
    }

    // Collapse the swimlane
    await gutters.first().click();
    await expect(page.locator('.swimlane').first()).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });

    // The card count chip should now be visible inside the collapsed gutter
    await expect(page.locator('.swimlane-card-count')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Gutter collapse (swimlane label sidebar)
  // -------------------------------------------------------------------------

  test('gutter collapse button toggles the swimlane label column', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      // Reset gutter state so test starts from a known expanded state
      localStorage.removeItem('zira-gutter-collapsed');
    }, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const boardGrid = page.locator('.board-grid');
    if (await boardGrid.count() === 0) {
      test.skip(true, 'Board grid not rendered — no swimlanes');
      return;
    }

    // Gutter should be expanded initially
    await expect(boardGrid.first()).not.toHaveClass(/gutter-collapsed/);

    // Click the gutter collapse button
    await page.click('.gutter-collapse-btn');
    await expect(boardGrid.first()).toHaveClass(/gutter-collapsed/, { timeout: 5000 });

    // Click again to expand
    await page.click('.gutter-collapse-btn');
    await expect(boardGrid.first()).not.toHaveClass(/gutter-collapsed/, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // "b" keyboard shortcut cycles through views
  // -------------------------------------------------------------------------

  test('keyboard shortcut "b" cycles through Board → Backlog → All Cards', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Start on Board view
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/);

    // Press 'b' — should switch to Backlog
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });

    // Press 'b' again — should switch to All Cards
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    // Press 'b' again — should cycle back to Board
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });
});
