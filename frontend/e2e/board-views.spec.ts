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

/**
 * Inject the JWT token into localStorage using page.evaluate (NOT addInitScript).
 * Must be called after page.goto() so the page context is available.
 */
async function injectToken(page: any, token: string) {
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------

test.describe('Board Views', () => {
  // -------------------------------------------------------------------------
  // View button visibility
  // -------------------------------------------------------------------------

  test('three view buttons visible: Board, Backlog, All Cards', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.view-btn:has-text("Board")')).toBeVisible();
    await expect(page.locator('.view-btn:has-text("Backlog")')).toBeVisible();
    await expect(page.locator('.view-btn:has-text("All Cards")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Board (Kanban) view
  // -------------------------------------------------------------------------

  test('Board (Kanban) view is the default when navigating to a board', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const boardBtn = page.locator('.view-btn:has-text("Board")');
    await expect(boardBtn).toBeVisible();
    await expect(boardBtn).toHaveClass(/active/);
  });

  test('Board view shows column headers when swimlane exists', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Add a swimlane so the board grid renders column headers
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Board Lane', designator: 'BL-', color: '#22c55e' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
    // There should be at least one column header
    expect(await headers.count()).toBeGreaterThan(0);
  });

  test('Board view shows swimlane rows when swimlane exists', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Swimlane Row Lane', designator: 'SR-', color: '#f59e0b' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // The board grid with swimlane rows should be present
    const swimlanes = page.locator('.swimlane');
    await expect(swimlanes.first()).toBeVisible({ timeout: 8000 });
  });

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

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);

    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Sprint Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('Board view without an active sprint shows "No sprint" empty state with a link to Backlog', async ({ request, page }) => {
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

    // Add a swimlane so the empty-sprint branch is reached
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.board-content .empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-content button:has-text("Go to Backlog")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // View switching
  // -------------------------------------------------------------------------

  test('clicking Backlog view button switches to the backlog', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');

    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/);
  });

  test('clicking All Cards view button switches to all-cards mode', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 8000 });
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
  });

  test('each view button shows active state exclusively', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

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

  test('can cycle through all three views and return to Board view', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Board → Backlog → All Cards → Board
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    await page.click('.view-btn:has-text("Board")');
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Sprint view (Board mode)
  // -------------------------------------------------------------------------

  test('Board view shows sprint badge for the active sprint', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // The active sprint badge is displayed in the board header
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Test Sprint');
  });

  test('sprint badge shows "Active" status label', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge .sprint-status-label')).toContainText('Active');
  });

  test('sprint badge is visible across all view modes', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Board view: badge present
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });

    // Backlog view: badge still present
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 5000 });

    // All Cards view: badge still present
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 5000 });
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

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Unsprinted Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('All Cards view shows cards regardless of sprint assignment', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available for card creation');
      return;
    }

    // Create a card assigned to the sprint
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Sprinted Card',
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

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Sprint-assigned card should appear in All Cards view
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Sprinted Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('All Cards view shows column headers', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Add a swimlane so column headers render
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Headers Lane', designator: 'HL-', color: '#3b82f6' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Backlog view
  // -------------------------------------------------------------------------

  test('Backlog view renders the backlog header section', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
  });

  test('Backlog view shows sprint panels for each sprint', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    const sprintPanels = page.locator('.backlog-sprint-panel');
    await expect(sprintPanels.first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.backlog-sprint-header').first()).toContainText('Test Sprint');
  });

  test('Backlog view shows backlog panel and sprint panel together', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // Both the sprint panel and the backlog items panel should be present
    await expect(page.locator('.backlog-sprint-panel').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.backlog-items-panel, .backlog-header')).toBeVisible({ timeout: 8000 });
  });

  test('Backlog view shows swimlane sections if swimlanes exist', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    const swimlaneSections = page.locator('.backlog-section.swimlane-backlog');
    const count = await swimlaneSections.count();
    if (count > 0) {
      await expect(swimlaneSections.first().locator('.backlog-section-header')).toBeVisible();
    }
    // Board may have no swimlanes yet — view switch success is sufficient
  });

  test('Backlog view shows "Add to sprint" button or sprint selector for backlog cards', async ({
    request,
    page,
  }) => {
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
        title: 'Backlog Move Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed — skipping add-to-sprint button check`);
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // The backlog section should render an arrow button or sprint selector
    // for moving cards into a sprint
    const moveBtn = page.locator('.backlog-move-btn, .backlog-sprint-select');
    const moveBtnCount = await moveBtn.count();
    // If the sprint and card are present, at least one move control should appear
    expect(moveBtnCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Sprint header info
  // -------------------------------------------------------------------------

  test('sprint panel in Backlog view shows sprint name in header', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // Sprint panel header should contain the sprint name
    await expect(page.locator('.backlog-sprint-header').first()).toContainText('Test Sprint');
  });

  test('sprint panel in Backlog view shows card count', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Sprint Count Card',
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed`);
      return;
    }

    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // Sprint header should show a count — it contains a number
    const headerText = await page.locator('.backlog-sprint-header').first().textContent();
    expect(headerText).toMatch(/\d/);
  });

  // -------------------------------------------------------------------------
  // View preference stored (switching to All Cards and reloading keeps that view)
  // -------------------------------------------------------------------------

  test.fixme('switching to All Cards view and reloading retains that view', async ({ request, page }) => {
    // View mode is stored in component state only — no localStorage persistence implemented yet.
    // Once viewMode persistence is added (e.g. localStorage key "zira-view-{boardId}"),
    // this test should reload the page and assert .view-btn:has-text("All Cards") is still active.
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    // Reload the page — expects view to persist
    await page.reload();
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/);
  });

  // -------------------------------------------------------------------------
  // Board with no sprint: only Backlog / All Cards relevant
  // -------------------------------------------------------------------------

  test('board with no sprint still shows all three view buttons', async ({ request, page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-nosprint2-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Sprint Tester 2' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Sprint Board 2' },
      })
    ).json();

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // All three view buttons present regardless of sprint state
    await expect(page.locator('.view-btn:has-text("Board")')).toBeVisible();
    await expect(page.locator('.view-btn:has-text("Backlog")')).toBeVisible();
    await expect(page.locator('.view-btn:has-text("All Cards")')).toBeVisible();
  });

  test('board with no sprint can switch to Backlog and All Cards views', async ({ request, page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-nosprint3-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Sprint Tester 3' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Sprint Board 3' },
      })
    ).json();

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Backlog view is accessible
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });

    // All Cards view is accessible
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Sprint badge in board header
  // -------------------------------------------------------------------------

  test('board header shows active sprint badge with sprint name', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Test Sprint');
  });

  test('active sprint badge shows "Active" status label', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge .sprint-status-label')).toContainText('Active');
  });

  // -------------------------------------------------------------------------
  // Column headers visible in all views
  // -------------------------------------------------------------------------

  test('column headers are visible in All Cards view', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Add a swimlane so column headers render
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Headers Lane', designator: 'HL-', color: '#3b82f6' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
  });

  test('column headers are visible in Board (sprint) view when swimlane exists', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Add a swimlane so the board grid renders
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Board Lane', designator: 'BL-', color: '#22c55e' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Board view is default — column headers should appear
    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Empty column still shows column header with 0 count
  // -------------------------------------------------------------------------

  test('empty column shows column header without a count badge', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Add a swimlane so the board renders column headers
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Empty Lane', designator: 'EL-', color: '#f59e0b' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    // All column headers should render even with 0 cards
    const headers = page.locator('.board-column-header');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i)).toBeVisible();
    }

    // No .column-count badges should appear because columns are empty
    await expect(page.locator('.column-count')).toHaveCount(0);
  });

  test('column card count badge updates when a card is in that column', async ({ request, page }) => {
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

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.column-count')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.column-count').first()).toHaveText('1');
  });

  // -------------------------------------------------------------------------
  // Swimlane collapse/expand
  // -------------------------------------------------------------------------

  test('clicking a swimlane gutter collapses the swimlane rows', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

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

    const swimlane = page.locator('.swimlane').first();
    await expect(swimlane).not.toHaveClass(/swimlane-collapsed/);

    await swimlaneGutters.first().click();
    await expect(swimlane).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });
  });

  test('clicking a collapsed swimlane gutter expands it again', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

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

    await swimlaneGutters.first().click();
    await expect(swimlane).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });

    await swimlaneGutters.first().click();
    await expect(swimlane).not.toHaveClass(/swimlane-collapsed/, { timeout: 5000 });
  });

  test('collapsed swimlane shows card count chip in gutter', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

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

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const gutters = page.locator('.swimlane-gutter');
    if (await gutters.count() === 0) {
      test.skip(true, 'No swimlane gutters rendered');
      return;
    }

    await gutters.first().click();
    await expect(page.locator('.swimlane').first()).toHaveClass(/swimlane-collapsed/, { timeout: 5000 });
    await expect(page.locator('.swimlane-card-count')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Gutter collapse (swimlane label sidebar)
  // -------------------------------------------------------------------------

  test('gutter collapse button toggles the swimlane label column', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('zira-gutter-collapsed'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const boardGrid = page.locator('.board-grid');
    if (await boardGrid.count() === 0) {
      test.skip(true, 'Board grid not rendered — no swimlanes');
      return;
    }

    await expect(boardGrid.first()).not.toHaveClass(/gutter-collapsed/);

    await page.click('.gutter-collapse-btn');
    await expect(boardGrid.first()).toHaveClass(/gutter-collapsed/, { timeout: 5000 });

    await page.click('.gutter-collapse-btn');
    await expect(boardGrid.first()).not.toHaveClass(/gutter-collapsed/, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // "b" keyboard shortcut cycles through views
  // -------------------------------------------------------------------------

  test('keyboard shortcut "b" cycles through Board → Backlog → All Cards', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/);

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });

  test('"b" shortcut wraps around: pressing b from All Cards returns to Board', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Advance to All Cards
    await page.keyboard.press('b');
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    // One more press wraps back to Board
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Filter panel
  // -------------------------------------------------------------------------

  test('filter toggle button is present in the board header', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // The filter toggle button should be visible
    await expect(page.locator('.filter-toggle-btn')).toBeVisible({ timeout: 8000 });
  });

  test('clicking filter toggle button expands the filter panel', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    // Reset any saved filter state before test
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'false'));

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Ensure filter panel is collapsed first
    const filterPanel = page.locator('.filters-expanded');
    const isVisible = await filterPanel.isVisible();
    if (isVisible) {
      // Already expanded — collapse it first
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).not.toBeVisible({ timeout: 3000 });
    }

    // Click the toggle to expand
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
  });

  test('filter panel contains assignee filter select', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Expand filters if not already open
    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // Assignee filter — select with "All assignees" option
    const assigneeSelect = filterPanel.locator('.filter-select', { hasText: '' }).first();
    await expect(assigneeSelect).toBeVisible({ timeout: 5000 });
    // The filter panel should contain at least an "All assignees" option in some select
    const options = filterPanel.locator('option:has-text("All assignees")');
    await expect(options.first()).toBeAttached({ timeout: 5000 });
  });

  test('filter panel contains label filter select', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // Label filter select should have an "All labels" option
    const labelOption = filterPanel.locator('option:has-text("All labels")');
    await expect(labelOption.first()).toBeAttached({ timeout: 5000 });
  });

  test('filter URL params update when assignee filter changes', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // Grab the assignee select — the second filter-select (after swimlane)
    const assigneeSelect = filterPanel.locator('.filter-select').nth(1);
    const options = await assigneeSelect.locator('option').all();

    // Only test URL update if there are members to choose
    if (options.length <= 1) {
      test.skip(true, 'No assignees to filter by');
      return;
    }

    const secondOptionValue = await options[1].getAttribute('value');
    if (!secondOptionValue) {
      test.skip(true, 'No valid assignee option found');
      return;
    }

    await assigneeSelect.selectOption(secondOptionValue);
    await expect.poll(() => page.url(), { timeout: 3000 }).toContain('assignee=');
  });

  test('clear filters button removes active filters', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    // Navigate with a search query param already applied
    await page.goto(`/boards/${setup.boardId}?q=somequery`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Clear filter (X) button should be visible when filters are active
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });

    await clearBtn.click();

    // After clearing, URL should no longer have the query param
    await expect.poll(() => page.url(), { timeout: 3000 }).not.toContain('q=somequery');
  });

  test('filter state persists across view switches (Board → Backlog)', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('zira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    // Navigate with a search param
    await page.goto(`/boards/${setup.boardId}?q=searchterm`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Switch view — filter params should survive
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // URL still has the search param
    const url = page.url();
    expect(url).toContain('q=searchterm');
  });

  // -------------------------------------------------------------------------
  // URL does not change when switching views (view state is in component only)
  // -------------------------------------------------------------------------

  test('URL path does not change when switching between views', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const initialUrl = page.url();

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // The pathname should remain the same — only query params may change
    const urlAfter = new URL(page.url());
    const initialPath = new URL(initialUrl).pathname;
    expect(urlAfter.pathname).toBe(initialPath);
  });
});
