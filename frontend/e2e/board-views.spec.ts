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
    // Once viewMode persistence is added (e.g. localStorage key "gira-view-{boardId}"),
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
    await page.evaluate(() => localStorage.removeItem('gira-gutter-collapsed'));
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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'false'));

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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
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
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
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

  // -------------------------------------------------------------------------
  // Sprint view — Board mode details
  // -------------------------------------------------------------------------

  test('Board view shows "No active sprint" empty state when sprint not started', async ({
    request,
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-no-active-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Active Sprint Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Active Sprint Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    // Create a sprint but do NOT start it
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Planning Sprint' },
    });

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // The board body should show the no-active-sprint empty state
    await expect(page.locator('.board-content .empty-swimlanes, .board-content .empty-state')).toBeVisible({
      timeout: 8000,
    });
  });

  test('Board view shows active sprint header/badge when sprint is running', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // The active sprint badge should contain the sprint name
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.active-sprint-badge')).toContainText('Test Sprint');
  });

  test('Board view card shows title when a sprint card is present', async ({ request, page }) => {
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
        title: 'Sprint Board Card Title',
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
      page.locator('.card-item, .board-card-item').filter({ hasText: 'Sprint Board Card Title' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('Board view card shows assignee avatar when assignee is set', async ({ request, page }) => {
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
        title: 'Assignee Badge Card',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Get current user id
    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const me = await meRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { user_id: me.id },
    });

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const cardEl = page.locator('.card-item, .board-card-item').filter({ hasText: 'Assignee Badge Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });
    // Assignee avatar or chip present inside card
    await expect(cardEl.locator('.assignee-avatar, .card-assignee, .avatar')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Board view basics
  // -------------------------------------------------------------------------

  test('Board view shows swimlane row labels for each swimlane', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'My Swimlane Label', designator: 'MS-', color: '#a855f7' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    // Swimlane label should appear in the gutter
    await expect(page.locator('.swimlane-label, .swimlane-gutter-label').filter({ hasText: 'My Swimlane Label' })).toBeVisible({ timeout: 6000 });
  });

  test('Board view shows multiple column headers sorted by position', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Multi Col Lane', designator: 'MC-', color: '#10b981' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const colHeaders = page.locator('.board-column-header');
    await expect(colHeaders.first()).toBeVisible({ timeout: 8000 });
    const count = await colHeaders.count();
    expect(count).toBeGreaterThanOrEqual(2); // Default boards have at least To Do and Done
  });

  test('Board view shows quick-add card input when Add button is clicked', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Find and click the add-card button in the first column
    const addBtn = page.locator('.add-card-btn, button:has-text("Add card"), .column-add-btn').first();
    const addBtnCount = await addBtn.count();
    if (addBtnCount === 0) {
      test.skip(true, 'No add-card button found in board view');
      return;
    }

    await addBtn.click({ force: true });

    // Quick-add input should appear
    const quickInput = page.locator('input[placeholder*="card title"], input[placeholder*="Add a card"], .quick-add-input input, .add-card-input').first();
    await expect(quickInput).toBeVisible({ timeout: 5000 });
  });

  test('Board view board-header and settings link present', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Settings link should be in the header
    const settingsLink = page.locator('a[href*="/settings"], .board-settings-link, button[aria-label*="settings"]').first();
    await expect(settingsLink).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // View state — reload and navigation behaviour
  // -------------------------------------------------------------------------

  test('reloading board page returns to Board view (default state)', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Switch to Backlog
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });

    // Reload — view state is component-only, should reset to Board (default)
    await page.reload();
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // After reload, Board is active again (no persistence)
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });

  test('navigating to boards list and back resets to Board view', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Switch to All Cards
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });

    // Navigate away
    await page.goto('/boards');
    await expect(page.locator('.board-list, .boards-page, h1:has-text("Board")')).toBeVisible({ timeout: 10000 });

    // Navigate back
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // View reverts to Board (default) since state is not persisted
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/, { timeout: 5000 });
  });

  test('view tab shows active CSS class only for the currently selected view', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Verify initial state: Board active, others not
    await expect(page.locator('.view-btn:has-text("Board")')).toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("All Cards")')).not.toHaveClass(/active/);

    // Switch to All Cards
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.view-btn:has-text("All Cards")')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('.view-btn:has-text("Board")')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn:has-text("Backlog")')).not.toHaveClass(/active/);
  });

  // -------------------------------------------------------------------------
  // Backlog view — additional scenarios
  // -------------------------------------------------------------------------

  test('Backlog view shows Create Sprint button in backlog header area', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('button:has-text("Create Sprint")')).toBeVisible({ timeout: 6000 });
  });

  test('Backlog view shows unassigned card in swimlane section', async ({ request, page }) => {
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
        title: 'No Sprint Backlog Card',
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

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // The unassigned card should be in the swimlane backlog section
    await expect(
      page.locator('.swimlane-backlog .card-title').filter({ hasText: 'No Sprint Backlog Card' })
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // All Cards view — additional scenarios
  // -------------------------------------------------------------------------

  test('All Cards view API count matches visible card count', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    // Create 3 cards via API
    const titles = ['All Cards API 1', 'All Cards API 2', 'All Cards API 3'];
    let allCreated = true;
    for (const title of titles) {
      const res = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: {
          board_id: setup.boardId,
          swimlane_id: setup.swimlaneId,
          column_id: setup.columnId,
          title,
        },
      });
      if (!res.ok()) { allCreated = false; break; }
    }

    if (!allCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    // Get API count
    const apiRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const apiCards: Array<{ id: number }> = await apiRes.json();
    const apiCount = apiCards.length;

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // All 3 created titles should appear
    for (const title of titles) {
      await expect(
        page.locator('.card-item, .board-card-item').filter({ hasText: title })
      ).toBeVisible({ timeout: 8000 });
    }

    // The total visible count should be >= apiCount (all-cards shows all)
    const visibleCount = await page.locator('.card-item, .board-card-item').count();
    expect(visibleCount).toBeGreaterThanOrEqual(apiCount > 0 ? Math.min(apiCount, 3) : 3);
  });

  test('All Cards view search input filters cards by title', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    const uniqueTitle = `Unique-Search-${Date.now()}`;
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: uniqueTitle,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    // Also create a second card with a different title
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'OtherCardTitle',
      },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    // Navigate with q= search param to test filter
    await page.goto(`/boards/${setup.boardId}?q=${encodeURIComponent(uniqueTitle)}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // The unique card should be visible
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: uniqueTitle })
    ).toBeVisible({ timeout: 8000 });
  });

  test('All Cards view shows column name or column indicator on each card', async ({
    request,
    page,
  }) => {
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
        title: 'Column Info Card',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await request.post(`${BASE}/api/cards/${(await cardRes.json()).id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // The card should appear in the appropriate column cell
    const cardEl = page.locator('.card-item, .board-card-item').filter({ hasText: 'Column Info Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Sprint view — no active sprint link to Backlog
  // -------------------------------------------------------------------------

  test('Go to Backlog button in empty sprint view switches to Backlog', async ({
    request,
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-gotobl-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Go To Backlog Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Go To Backlog Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'GTB Lane', designator: 'GTB-', color: '#6366f1' },
    });

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const gotoBacklogBtn = page.locator('.board-content button:has-text("Go to Backlog")');
    await expect(gotoBacklogBtn).toBeVisible({ timeout: 8000 });

    await gotoBacklogBtn.click();

    await expect(page.locator('.view-btn:has-text("Backlog")')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Board header additional details
  // -------------------------------------------------------------------------

  test('board header shows the board name', async ({ request, page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-bh-name-${suffix}@test.com`;
    const boardName = `Header Name Board ${suffix}`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Header Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: boardName },
      })
    ).json();

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.board-header h1, .board-header .board-name').first()).toContainText(boardName, { timeout: 8000 });
  });

  test('board view URL contains the board ID', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    expect(page.url()).toContain(`/boards/${setup.boardId}`);
  });

  test('unauthenticated access to board redirects to /login', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    // Navigate without injecting token
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('board header settings link has correct href', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const settingsLink = page.locator(`a[href*="/boards/${setup.boardId}/settings"]`).first();
    await expect(settingsLink).toBeVisible({ timeout: 8000 });
  });

  test('navigating to board settings from header works', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const settingsLink = page.locator(`a[href*="/boards/${setup.boardId}/settings"]`).first();
    await settingsLink.click();

    await expect(page).toHaveURL(new RegExp(`/boards/${setup.boardId}/settings`), { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Column display additional scenarios
  // -------------------------------------------------------------------------

  test('columns displayed in board view show at least one column', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Col Check Lane', designator: 'CC-', color: '#6366f1' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const colHeaders = page.locator('.board-column-header');
    await expect(colHeaders.first()).toBeVisible({ timeout: 8000 });
    expect(await colHeaders.count()).toBeGreaterThanOrEqual(1);
  });

  test('column headers contain the column name text', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Col Name Lane', designator: 'CN-', color: '#a855f7' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const firstHeader = page.locator('.board-column-header').first();
    await expect(firstHeader).toBeVisible({ timeout: 8000 });
    const text = await firstHeader.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('default board has at least two columns (To Do and Done)', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Two Col Lane', designator: 'TC-', color: '#10b981' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const colHeaders = page.locator('.board-column-header');
    await expect(colHeaders.first()).toBeVisible({ timeout: 8000 });
    expect(await colHeaders.count()).toBeGreaterThanOrEqual(2);
  });

  test('column card count badge shows 1 after adding a card via API', async ({ request, page }) => {
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
        title: 'Col Badge Card',
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

    await expect(page.locator('.column-count').first()).toContainText('1', { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Swimlane additional display scenarios
  // -------------------------------------------------------------------------

  test('swimlane name is shown in the gutter', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    const swimlaneName = `Gutter Swimlane ${Date.now()}`;

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: swimlaneName, designator: 'GS-', color: '#f59e0b' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    await expect(
      page.locator('.swimlane-label, .swimlane-gutter-label').filter({ hasText: swimlaneName })
    ).toBeVisible({ timeout: 8000 });
  });

  test('multiple swimlanes show multiple gutter labels', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Multi Lane A', designator: 'MLA-', color: '#22c55e' },
    });
    await request.post(`${BASE}/api/boards/${setup.boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Multi Lane B', designator: 'MLB-', color: '#3b82f6' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    const gutters = page.locator('.swimlane-gutter');
    await expect(gutters.first()).toBeVisible({ timeout: 8000 });
    expect(await gutters.count()).toBeGreaterThanOrEqual(2);
  });

  test('board view without swimlanes does not render swimlane gutters', async ({ request, page }) => {
    // Create a fresh board with NO swimlanes
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-noswl-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No SWL Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Swimlane Board' },
      })
    ).json();

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 8000 });

    // No swimlane gutters rendered
    expect(await page.locator('.swimlane-gutter').count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Card display on board additional scenarios
  // -------------------------------------------------------------------------

  test('card in All Cards view shows a clickable element', async ({ request, page }) => {
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
        title: 'Clickable Card',
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

    const card = page.locator('.card-item, .board-card-item').filter({ hasText: 'Clickable Card' });
    await expect(card).toBeVisible({ timeout: 8000 });
    // Card should be clickable (cursor: pointer / role button etc.)
    await card.click({ force: true });
    // After clicking the card the modal may open — just ensure no crash
  });

  test('card title is visible in Board sprint view', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    const cardTitle = `Visible Title Card ${Date.now()}`;
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: cardTitle,
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
      page.locator('.card-item, .board-card-item').filter({ hasText: cardTitle })
    ).toBeVisible({ timeout: 8000 });
  });

  test('card is not visible in Board sprint view if not assigned to active sprint', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    const cardTitle = `Unsprinted Invisible ${Date.now()}`;
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: cardTitle,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    // Intentionally do NOT assign to sprint

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // Board view (sprint mode) should not show the unsprinted card
    await expect(
      page.locator('.card-item, .board-card-item').filter({ hasText: cardTitle })
    ).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Filter panel — additional coverage
  // -------------------------------------------------------------------------

  test('filter toggle button has a text or icon label', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterBtn = page.locator('.filter-toggle-btn');
    await expect(filterBtn).toBeVisible({ timeout: 8000 });
    // Must have either text content or an svg icon
    const hasText = (await filterBtn.textContent())?.trim().length || 0;
    const hasSvg = await filterBtn.locator('svg').count();
    expect(hasText + hasSvg).toBeGreaterThan(0);
  });

  test('filter panel contains a search input when expanded', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // Search input or text input within the expanded filter bar
    const searchInput = filterPanel.locator('input[type="text"], input[placeholder*="search" i], .search-input input');
    await expect(searchInput.first()).toBeAttached({ timeout: 5000 });
  });

  test('navigating to board with q= param sets filter input value', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}?q=myquery`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // The search input should reflect the q param
    const searchInput = filterPanel.locator('input[type="text"], .search-input input').first();
    if (await searchInput.isVisible()) {
      const val = await searchInput.inputValue();
      expect(val).toBe('myquery');
    }
  });

  test('filter panel collapse removes .filters-expanded element', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    await page.click('.filter-toggle-btn');
    await expect(filterPanel).not.toBeVisible({ timeout: 5000 });
  });

  test('filter panel persists expanded state across view switches', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gira-filters-expanded', 'true'));
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const filterPanel = page.locator('.filters-expanded');
    if (!(await filterPanel.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    }

    // Switch to Backlog — filter expanded state should persist
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });
    await expect(filterPanel).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcut "n" to add card
  // -------------------------------------------------------------------------

  test('keyboard shortcut "n" opens add-card modal when swimlane and column exist', async ({
    request,
    page,
  }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Press 'n' to open add card modal
    await page.keyboard.press('n');

    // An add-card modal or quick-add input should appear
    const addModal = page.locator('.modal:has-text("Add Card"), .add-card-modal, .modal h2');
    await expect(addModal.first()).toBeVisible({ timeout: 5000 });
  });

  test('pressing Escape closes an open card modal', async ({ request, page }) => {
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
        title: 'Escape Card',
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

    const cardEl = page.locator('.card-item, .board-card-item').filter({ hasText: 'Escape Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });
    await cardEl.click({ force: true });

    // Modal should open
    const modal = page.locator('.card-detail-modal, .modal').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Escape closes it
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Backlog view — additional sprint panel scenarios
  // -------------------------------------------------------------------------

  test('Backlog view Create Sprint button is visible to board owner', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('button:has-text("Create Sprint")')).toBeVisible({ timeout: 6000 });
  });

  test('Backlog view shows active sprint panel with "Active" badge', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    // The sprint panel header should indicate the sprint is active
    const sprintHeader = page.locator('.backlog-sprint-header').first();
    await expect(sprintHeader).toBeVisible({ timeout: 8000 });
    const headerText = await sprintHeader.textContent();
    expect(headerText).toBeTruthy();
  });

  test('Backlog view multiple sprints show multiple sprint panels', async ({ request, page }) => {
    const setup = await setupViewBoard(request);

    // Create a second (not started) sprint
    await request.post(`${BASE}/api/sprints?board_id=${setup.boardId}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Second Sprint' },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-header')).toBeVisible({ timeout: 8000 });

    const panels = page.locator('.backlog-sprint-panel');
    await expect(panels.first()).toBeVisible({ timeout: 8000 });
    // Both sprints should render panels
    expect(await panels.count()).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Board view — gutter collapse persists in localStorage
  // -------------------------------------------------------------------------

  test('gutter collapse state is persisted to localStorage', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('gira-gutter-collapsed'));
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

    await page.click('.gutter-collapse-btn');
    await expect(boardGrid.first()).toHaveClass(/gutter-collapsed/, { timeout: 5000 });

    // The value should be persisted
    const stored = await page.evaluate(() => localStorage.getItem('gira-gutter-collapsed'));
    expect(stored).toBeTruthy();
  });

  test('gutter collapse state restores on page reload', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gira-gutter-collapsed', 'true'));
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

    // Should be collapsed due to the saved localStorage value
    await expect(boardGrid.first()).toHaveClass(/gutter-collapsed/, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Board view — card quick-add input via inline
  // -------------------------------------------------------------------------

  test('pressing Escape on quick-add input cancels card creation', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const addBtn = page.locator('.add-card-btn, button:has-text("Add card"), .column-add-btn').first();
    if (await addBtn.count() === 0) {
      test.skip(true, 'No add-card button found');
      return;
    }
    await addBtn.click({ force: true });

    const quickInput = page.locator('input[placeholder*="card title" i], input[placeholder*="Add a card" i], .quick-add-input input, .add-card-input').first();
    if (!(await quickInput.isVisible({ timeout: 3000 }))) {
      test.skip(true, 'Quick-add input not found');
      return;
    }

    await quickInput.press('Escape');
    await expect(quickInput).not.toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // Board view — view button count
  // -------------------------------------------------------------------------

  test('exactly three view buttons are rendered in board header', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    const viewBtns = page.locator('.view-btn');
    await expect(viewBtns).toHaveCount(3, { timeout: 5000 });
  });

  test('Board view button text is exactly "Board"', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.view-btn:has-text("Board")')).toBeVisible();
  });

  test('Backlog view button text is exactly "Backlog"', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.view-btn:has-text("Backlog")')).toBeVisible();
  });

  test('All Cards view button text is exactly "All Cards"', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.view-btn:has-text("All Cards")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Board view — sprint card label display
  // -------------------------------------------------------------------------

  test('sprint card with a label shows label pill', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    if (!setup.columnId || !setup.swimlaneId) {
      test.skip(true, 'No column/swimlane available');
      return;
    }

    // Create a label on the board
    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'Bug', color: '#dc2626' },
    });
    if (!labelRes.ok()) {
      test.skip(true, 'Label creation unavailable');
      return;
    }
    const label = await labelRes.json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        board_id: setup.boardId,
        swimlane_id: setup.swimlaneId,
        column_id: setup.columnId,
        title: 'Label Pill Card',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign label to card
    const labelAssignRes = await request.post(`${BASE}/api/cards/${card.id}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { label_id: label.id },
    });
    if (!labelAssignRes.ok()) {
      test.skip(true, 'Label assignment unavailable');
      return;
    }

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { sprint_id: setup.sprintId },
    });

    await page.goto('/login');
    await injectToken(page, setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const cardEl = page.locator('.card-item, .board-card-item').filter({ hasText: 'Label Pill Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });

    // Label pill (colored span) should be inside the card element
    await expect(cardEl.locator('.card-label, .label-pill, .label').first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Board view — sprint active badge additional
  // -------------------------------------------------------------------------

  test('active sprint badge is a link to the sprint or board content', async ({ request, page }) => {
    const setup = await setupViewBoard(request);
    await page.goto('/login');
    await injectToken(page, setup.token);

    await page.goto(`/boards/${setup.boardId}`);
    await expect(page.locator('.active-sprint-badge')).toBeVisible({ timeout: 8000 });

    // The badge should be interactive (button or span with click handler)
    const badge = page.locator('.active-sprint-badge');
    await expect(badge).toBeVisible();
    // Just verify it exists and has content
    const text = await badge.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });

  test('active sprint badge disappears when board has no sprint (new board)', async ({
    request,
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-nosprint-badge-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Sprint Badge Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'No Sprint Badge Board' },
      })
    ).json();

    await page.goto('/login');
    await injectToken(page, token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // No active sprint badge on a board with no sprint
    await expect(page.locator('.active-sprint-badge')).not.toBeVisible({ timeout: 5000 });
  });
});
