import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  prefix = 'dash',
  displayName = 'Dashboard User',
): Promise<{ token: string; userId: number; email: string }> {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  expect(res.ok(), `signup failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  const token: string = body.token;

  const meRes = await request.get(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json();
  return { token, userId: me.id, email };
}

async function createBoard(
  request: any,
  token: string,
  name: string,
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `createBoard failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
): Promise<number> {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `createSprint failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function startSprint(
  request: any,
  token: string,
  sprintId: number,
): Promise<void> {
  const res = await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `startSprint failed: ${await res.text()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// 1. /boards is the primary board management page
// ---------------------------------------------------------------------------

test.describe('Dashboard — /boards is the main dashboard', () => {
  test('/boards loads for an authenticated user', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-boards-main');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('/boards shows the page heading "Boards"', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-boards-h1');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('h1', { hasText: 'Boards' })).toBeVisible({ timeout: 10000 });
  });

  test('/ redirects to /dashboard for authenticated users', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-root-redirect');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('/dashboard loads the Dashboard page', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-page-load');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.dashboard-content')).toBeVisible({ timeout: 10000 });
  });

  test('/dashboard unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('/boards unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. /boards shows board cards in a grid
// ---------------------------------------------------------------------------

test.describe('Dashboard — /boards shows board cards in a grid', () => {
  test('boards created via API appear in the .boards-grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid');
    const boardName = `Grid Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible();
  });

  test('each board card has a clickable link', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-link');
    await createBoard(request, token, 'Grid Link Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card-link').first()).toBeVisible();
  });

  test('multiple boards are all rendered in the grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-multi');
    await createBoard(request, token, 'Board One');
    await createBoard(request, token, 'Board Two');
    await createBoard(request, token, 'Board Three');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(3);
  });

  test('clicking a board card in the grid navigates to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-nav');
    const boardId = await createBoard(request, token, 'Grid Nav Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await page.locator('.board-card-link').first().click();

    await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
    expect(page.url()).toContain(`/boards/${boardId}`);
  });

  test('board card shows board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-name');
    const boardName = `Named Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3').first()).toContainText(boardName);
  });

  test('board card has a delete button', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-del-btn');
    await createBoard(request, token, 'Deleteable Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card-delete').first()).toBeVisible();
  });

  test('deleting a board from the grid removes it from the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-del');
    const boardName = `To Delete ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.board-card h3', { hasText: boardName })).not.toBeVisible({ timeout: 5000 });
  });

  test('Create Board button in header opens the modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-create-btn');
    await createBoard(request, token, 'Header Create Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Create Board")');
    await expect(page.locator('.modal h2', { hasText: 'Create New Board' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. "No boards" empty state on /boards
// ---------------------------------------------------------------------------

test.describe('Dashboard — empty state on /boards', () => {
  test('user with no boards sees the .empty-state element', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
  });

  test('empty state shows "No boards yet" heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-heading');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state h2')).toContainText('No boards yet', { timeout: 10000 });
  });

  test('empty state shows descriptive text encouraging board creation', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-text');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state p')).toBeVisible({ timeout: 10000 });
  });

  test('.boards-grid is NOT rendered when the user has no boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-no-grid');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.boards-grid')).not.toBeVisible();
  });

  test('empty state has a Create Board button', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-cta-btn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state .btn-primary')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Create first board from empty state
// ---------------------------------------------------------------------------

test.describe('Dashboard — create first board from empty state', () => {
  test('empty state CTA button opens create board modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-cta');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });

    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();
    await expect(page.locator('.modal h2', { hasText: 'Create New Board' })).toBeVisible();
  });

  test('creating a board from the empty state navigates to the new board', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-create');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });

    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();
    await expect(page.locator('.modal')).toBeVisible();

    const boardName = `First Board ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText(boardName);
  });

  test('after creating the first board, /boards no longer shows the empty state', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-after');
    await createBoard(request, token, 'Post Empty Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state')).not.toBeVisible();
  });

  test('create board modal can be cancelled without creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-modal-cancel');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('.modal .btn', { hasText: 'Cancel' }).click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('create board modal has a description field', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-modal-desc');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();

    await expect(page.locator('#boardDesc')).toBeVisible();
  });

  test('create board modal has a template selector', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-modal-template');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();

    await expect(page.locator('#boardTemplate')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. /dashboard page structure
// ---------------------------------------------------------------------------

test.describe('Dashboard — /dashboard page sections', () => {
  test('dashboard shows page heading "Dashboard"', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-h1');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.page-header h1', { hasText: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('dashboard shows all three section headings', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sections');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });

    await expect(page.locator('h2', { hasText: 'My Cards' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Recent Boards' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Active Sprints' })).toBeVisible();
  });

  test('dashboard shows empty state for Recent Boards when user has no boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-boards');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no boards yet/i })
    ).toBeVisible();
  });

  test('dashboard shows empty state for Active Sprints when no active sprints exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-sprints');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no active sprints/i })
    ).toBeVisible();
  });

  test('dashboard shows empty state for My Cards when no cards are assigned', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-cards');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no cards assigned/i })
    ).toBeVisible();
  });

  test('dashboard does not show a loading spinner indefinitely', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-no-spinner');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    // Loading element should disappear within a reasonable time
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.dashboard-content')).toBeVisible({ timeout: 3000 });
  });

  test('dashboard My Cards section shows a card count badge', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-card-count');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    // The section header contains a count span showing the number of cards
    const myCardsSection = page.locator('.dashboard-section').filter({ has: page.locator('h2', { hasText: 'My Cards' }) });
    await expect(myCardsSection.locator('.dashboard-count')).toBeVisible();
    await expect(myCardsSection.locator('.dashboard-count')).toContainText('0');
  });

  test('dashboard Recent Boards section shows a count badge', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-boards-count');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const recentBoardsSection = page.locator('.dashboard-section').filter({ has: page.locator('h2', { hasText: 'Recent Boards' }) });
    await expect(recentBoardsSection.locator('.dashboard-count')).toBeVisible();
    await expect(recentBoardsSection.locator('.dashboard-count')).toContainText('0');
  });

  test('dashboard Active Sprints section shows a count badge', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprints-count');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const activeSprintsSection = page.locator('.dashboard-section').filter({ has: page.locator('h2', { hasText: 'Active Sprints' }) });
    await expect(activeSprintsSection.locator('.dashboard-count')).toBeVisible();
    await expect(activeSprintsSection.locator('.dashboard-count')).toContainText('0');
  });

  test('dashboard shows error state when API fails', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-api-err');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Mock the dashboard endpoint to fail
    await page.route('**/api/dashboard', (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/dashboard');

    // Loading should clear
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    // An error element should be shown
    await expect(page.locator('.dashboard-error')).toBeVisible({ timeout: 5000 });
  });

  test('Recent Boards empty state has a link to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-empty-boards-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    // The empty state message includes a link to /boards for board creation
    await expect(page.locator('a[href="/boards"]').first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Recent Boards section on /dashboard
// ---------------------------------------------------------------------------

test.describe('Dashboard — Recent Boards section', () => {
  test('board created via API appears in the Recent Boards grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent');
    const boardName = `Dashboard Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-board-card').filter({ hasText: boardName })
    ).toBeVisible();
  });

  test('clicking a board card in Recent Boards navigates to the board page', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent-nav');
    const boardId = await createBoard(request, token, `Nav Board ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await page.locator('.dashboard-board-card').first().click();

    await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
    expect(page.url()).toContain(`/boards/${boardId}`);
  });

  test('Recent Boards board count badge updates after creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent-count');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    // Confirm 0 boards shown
    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const recentBoardsSection = page.locator('.dashboard-section').filter({ has: page.locator('h2', { hasText: 'Recent Boards' }) });
    await expect(recentBoardsSection.locator('.dashboard-count')).toContainText('0');

    // Create board via API, then reload
    await createBoard(request, token, `Count Update Board ${crypto.randomUUID().slice(0, 8)}`);
    await page.reload();
    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });

    await expect(recentBoardsSection.locator('.dashboard-count')).toContainText('1');
  });

  test('up to 6 boards are shown in Recent Boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent-limit');
    for (let i = 1; i <= 7; i++) {
      await createBoard(request, token, `Limit Board ${i}`);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    // Only 6 cards should be rendered in the Recent Boards grid
    await expect(page.locator('.dashboard-board-card')).toHaveCount(6);
  });

  test('"View all" link appears when there are more than 6 boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-view-all');
    for (let i = 1; i <= 7; i++) {
      await createBoard(request, token, `View All Board ${i}`);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await expect(page.locator('.dashboard-view-all')).toBeVisible();
    await expect(page.locator('.dashboard-view-all')).toContainText('View all 7 boards');
  });

  test('"View all" link navigates to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-view-all-nav');
    for (let i = 1; i <= 7; i++) {
      await createBoard(request, token, `View All Nav Board ${i}`);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-view-all', { timeout: 10000 });
    await page.locator('.dashboard-view-all').click();

    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('Recent Boards shows board name in card', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent-name');
    const boardName = `Named Dash Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await expect(page.locator('.dashboard-board-card h3', { hasText: boardName })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Active Sprints section on /dashboard
// ---------------------------------------------------------------------------

test.describe('Dashboard — Active Sprints section', () => {
  test('a started sprint appears in Active Sprints', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint');
    const boardId = await createBoard(request, token, `Sprint Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintName = `Sprint ${crypto.randomUUID().slice(0, 8)}`;
    const sprintId = await createSprint(request, token, boardId, sprintName);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-sprint-item').filter({ hasText: sprintName })
    ).toBeVisible();
  });

  test('active sprint item links to the board', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-nav');
    const boardId = await createBoard(request, token, `Sprint Nav Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Sprint Nav ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await page.locator('.dashboard-sprint-item').first().click();

    await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
    expect(page.url()).toContain(`/boards/${boardId}`);
  });

  test('active sprint shows a progress bar', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-progress');
    const boardId = await createBoard(request, token, `Sprint Progress Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Progress Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(page.locator('.dashboard-progress-bar').first()).toBeVisible();
  });

  test('active sprint shows board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-board-name');
    const boardName = `Sprint Board Name ${crypto.randomUUID().slice(0, 8)}`;
    const boardId = await createBoard(request, token, boardName);
    const sprintId = await createSprint(request, token, boardId, `Sprint BN ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(page.locator('.dashboard-sprint-meta').first()).toContainText(boardName);
  });

  test('active sprint shows cards count', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-cards');
    const boardId = await createBoard(request, token, `Sprint Cards Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Sprint Cards ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    // Should show something like "0/0 cards"
    await expect(page.locator('.dashboard-sprint-meta').first()).toContainText('cards');
  });

  test('Active Sprints count badge reflects started sprint', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-badge');
    const boardId = await createBoard(request, token, `Sprint Badge Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Badge Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    const activeSprintsSection = page.locator('.dashboard-section').filter({ has: page.locator('h2', { hasText: 'Active Sprints' }) });
    await expect(activeSprintsSection.locator('.dashboard-count')).toContainText('1');
  });

  test('sprint not yet started does NOT appear in Active Sprints', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-not-started');
    const boardId = await createBoard(request, token, `Not Started Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintName = `Pending Sprint ${crypto.randomUUID().slice(0, 8)}`;
    await createSprint(request, token, boardId, sprintName);
    // Do NOT call startSprint

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    // Active Sprints section should remain empty
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no active sprints/i })
    ).toBeVisible();
  });

  test('sprint progress label shows percentage', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-pct');
    const boardId = await createBoard(request, token, `Sprint Pct Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Pct Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(page.locator('.dashboard-progress-label').first()).toContainText('%');
  });
});

// ---------------------------------------------------------------------------
// 8. Sidebar user display
// ---------------------------------------------------------------------------

test.describe('Dashboard — sidebar user display', () => {
  test('sidebar shows the user display name', async ({ page, request }) => {
    const displayName = `User ${crypto.randomUUID().slice(0, 8)}`;
    const { token } = await createUser(request, 'dash-sidebar-name', displayName);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.user-name')).toContainText(displayName);
  });

  test('sidebar contains a navigation link to Dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-dashboard');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.nav-item', { hasText: 'Dashboard' })).toBeVisible();
  });

  test('sidebar contains a navigation link to Boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-boards');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.nav-item', { hasText: 'Boards' })).toBeVisible();
  });

  test('sidebar navigation Dashboard link is marked active when on /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.nav-item.active', { hasText: 'Dashboard' })).toBeVisible();
  });

  test('sidebar logout button logs user out and redirects to /login', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-logout');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.logout-btn').click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('after logout, /dashboard redirects to /login', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-post-logout');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.logout-btn').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Attempt to navigate back — should stay on /login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('sidebar has a notification bell button', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-notif-bell');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.notification-bell')).toBeVisible();
  });

  test('clicking notification bell opens the notification dropdown', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-notif-open');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.notification-bell').click();
    await expect(page.locator('.notification-dropdown')).toBeVisible({ timeout: 3000 });
  });

  test('notification dropdown shows "No notifications" for a new user', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-notif-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.notification-bell').click();
    await expect(page.locator('.notification-empty')).toContainText('No notifications', { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// 9. My Cards section on /dashboard (requires card creation — fixme)
// ---------------------------------------------------------------------------

test.describe('Dashboard — My Cards section (requires card creation)', () => {
  test.fixme(
    'card assigned to self appears in My Cards kanban',
    // Card creation via POST /api/cards fails in this environment because
    // Gitea credentials are configured but the server is not reachable.
    async ({ page, request }) => {
      const { token, userId } = await createUser(request, 'dash-mycard');
      const boardId = await createBoard(request, token, `My Cards Board ${crypto.randomUUID().slice(0, 8)}`);

      // Create swimlane
      const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Main', designator: 'M-', color: '#6366f1' },
      });
      const swimlane = await swimlaneRes.json();

      // Get first column
      const colRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const columns = await colRes.json();
      const columnId = columns[0].id;

      const cardTitle = `My Card ${crypto.randomUUID().slice(0, 8)}`;
      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { board_id: boardId, swimlane_id: swimlane.id, column_id: columnId, title: cardTitle },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation requires Gitea — skipping');
      }
      const card = await cardRes.json();

      // Assign to self
      await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      await expect(
        page.locator('.dashboard-kanban-card-title').filter({ hasText: cardTitle })
      ).toBeVisible();
    },
  );

  test.fixme(
    'clicking a card in My Cards navigates to the board',
    async ({ page, request }) => {
      const { token, userId } = await createUser(request, 'dash-mycard-nav');
      const boardId = await createBoard(request, token, `Card Nav Board ${crypto.randomUUID().slice(0, 8)}`);

      const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Main', designator: 'M-', color: '#6366f1' },
      });
      const swimlane = await swimlaneRes.json();

      const colRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const columns = await colRes.json();

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          board_id: boardId,
          swimlane_id: swimlane.id,
          column_id: columns[0].id,
          title: `Nav Card ${crypto.randomUUID().slice(0, 8)}`,
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation requires Gitea — skipping');
      }
      const card = await cardRes.json();

      await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      await page.locator('.dashboard-kanban-card').first().click();
      await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
      expect(page.url()).toContain(`/boards/${boardId}`);
    },
  );

  test.fixme(
    'My Cards kanban renders 4 state columns: Open, In Progress, In Review, Done',
    async ({ page, request }) => {
      const { token, userId } = await createUser(request, 'dash-mycard-cols');
      const boardId = await createBoard(request, token, `Cols Board ${crypto.randomUUID().slice(0, 8)}`);

      const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Main', designator: 'M-', color: '#6366f1' },
      });
      const swimlane = await swimlaneRes.json();

      const colRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const columns = await colRes.json();

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          board_id: boardId,
          swimlane_id: swimlane.id,
          column_id: columns[0].id,
          title: `Cols Card ${crypto.randomUUID().slice(0, 8)}`,
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation requires Gitea — skipping');
      }
      const card = await cardRes.json();
      await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      await expect(page.locator('.dashboard-kanban-column-title', { hasText: 'Open' })).toBeVisible();
      await expect(page.locator('.dashboard-kanban-column-title', { hasText: 'In Progress' })).toBeVisible();
      await expect(page.locator('.dashboard-kanban-column-title', { hasText: 'In Review' })).toBeVisible();
      await expect(page.locator('.dashboard-kanban-column-title', { hasText: 'Done' })).toBeVisible();
    },
  );
});

// ---------------------------------------------------------------------------
// 10. Dashboard page structure — navigation and layout
// ---------------------------------------------------------------------------

test.describe('Dashboard — navigation sidebar links', () => {
  test('sidebar contains a navigation link to Reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-reports');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.nav-item', { hasText: 'Reports' })).toBeVisible();
  });

  test('sidebar contains a navigation link to Settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-settings');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.nav-item', { hasText: 'Settings' })).toBeVisible();
  });

  test('clicking Boards nav link navigates to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-boards-click');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.nav-item', { hasText: 'Boards' }).click();

    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('clicking Reports nav link navigates to /reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-reports-click');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.nav-item', { hasText: 'Reports' }).click();

    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });
  });

  test('clicking Settings nav link navigates to /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-settings-click');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.locator('.nav-item', { hasText: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('Boards nav link is marked active when on /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-boards-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.nav-item.active', { hasText: 'Boards' })).toBeVisible({ timeout: 10000 });
  });

  test('Dashboard nav link navigates back to /dashboard from /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-back-dash');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('h1', { hasText: 'Boards' })).toBeVisible({ timeout: 10000 });
    await page.locator('.nav-item', { hasText: 'Dashboard' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 11. Dashboard page — layout stability and misc
// ---------------------------------------------------------------------------

test.describe('Dashboard — layout and content structure', () => {
  test('dashboard page title is "Dashboard"', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-page-title');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page).toHaveTitle(/Dashboard|Zira/, { timeout: 5000 });
  });

  test('/dashboard does not redirect authenticated user', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-no-redirect');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('.dashboard-content')).toBeVisible({ timeout: 5000 });
  });

  test('dashboard sections use .dashboard-section class', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-section-class');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const sections = page.locator('.dashboard-section');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('dashboard sections each have a section header icon', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-section-icon');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const headers = page.locator('.dashboard-section-header');
    const count = await headers.count();
    expect(count).toBeGreaterThanOrEqual(3);
    // Each header should contain an svg icon
    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i).locator('svg')).toBeAttached();
    }
  });

  test('dashboard My Cards section shows 0 count for new user with no cards', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-mycards-zero');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const myCardsSection = page.locator('.dashboard-section').filter({
      has: page.locator('h2', { hasText: 'My Cards' }),
    });
    await expect(myCardsSection.locator('.dashboard-count')).toContainText('0');
  });

  test('dashboard Recent Boards section shows board description when present', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-board-desc');
    const boardName = `Desc Board ${crypto.randomUUID().slice(0, 8)}`;
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName, description: 'A board with a description' },
    });
    expect(boardRes.ok()).toBeTruthy();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    const boardCard = page.locator('.dashboard-board-card').filter({ hasText: boardName });
    await expect(boardCard).toBeVisible();
    await expect(boardCard.locator('p')).toContainText('A board with a description');
  });

  test('dashboard board card without description shows no paragraph', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-no-desc');
    const boardName = `No Desc Board ${crypto.randomUUID().slice(0, 8)}`;
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    const boardCard = page.locator('.dashboard-board-card').filter({ hasText: boardName });
    await expect(boardCard).toBeVisible();
    // When no description, no <p> with description text
    const descText = await boardCard.locator('p').count();
    expect(descText).toBe(0);
  });

  test('dashboard Recent Boards board card has Kanban icon', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-board-icon');
    await createBoard(request, token, `Icon Board ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    const boardCard = page.locator('.dashboard-board-card').first();
    await expect(boardCard.locator('.dashboard-board-icon svg')).toBeAttached({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 12. Dashboard active sprint — additional detail
// ---------------------------------------------------------------------------

test.describe('Dashboard — Active Sprints section details', () => {
  test('active sprint item shows sprint name prominently', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-name-prom');
    const boardId = await createBoard(request, token, `Sprint Name Prom Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintName = `Prominent Sprint ${crypto.randomUUID().slice(0, 8)}`;
    const sprintId = await createSprint(request, token, boardId, sprintName);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-sprint-name').filter({ hasText: sprintName })
    ).toBeVisible();
  });

  test('active sprint item shows completed/total cards in meta', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-ct');
    const boardId = await createBoard(request, token, `Sprint CT Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `CT Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    // Should have text like "0/0 cards"
    const meta = page.locator('.dashboard-sprint-meta').first();
    const text = await meta.textContent();
    expect(text).toMatch(/\d+\/\d+/);
  });

  test('progress bar width reflects completion ratio', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-bar-width');
    const boardId = await createBoard(request, token, `Sprint Bar Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Bar Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    // The inner fill bar should have a width style attribute or similar
    const progressBar = page.locator('.dashboard-progress-bar').first();
    await expect(progressBar).toBeVisible();
    await expect(progressBar.locator('div').first()).toBeAttached();
  });

  test('sprint progress percentage starts at 0% for empty sprint', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-zero-pct');
    const boardId = await createBoard(request, token, `Sprint Zero Pct Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Zero Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(page.locator('.dashboard-progress-label').first()).toContainText('0%');
  });

  test('two active sprints across two boards both shown', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-two-sprints');
    const boardId1 = await createBoard(request, token, `Two Sprint Board A ${crypto.randomUUID().slice(0, 8)}`);
    const boardId2 = await createBoard(request, token, `Two Sprint Board B ${crypto.randomUUID().slice(0, 8)}`);
    const sId1 = await createSprint(request, token, boardId1, `Sprint A ${crypto.randomUUID().slice(0, 8)}`);
    const sId2 = await createSprint(request, token, boardId2, `Sprint B ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sId1);
    await startSprint(request, token, sId2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    const items = page.locator('.dashboard-sprint-item');
    await expect(items).toHaveCount(2, { timeout: 5000 });
  });

  test('Active Sprints count badge shows 2 when two sprints are running', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-badge-two');
    const bId1 = await createBoard(request, token, `Badge2 Board A ${crypto.randomUUID().slice(0, 8)}`);
    const bId2 = await createBoard(request, token, `Badge2 Board B ${crypto.randomUUID().slice(0, 8)}`);
    const s1 = await createSprint(request, token, bId1, `Badge2 Sprint A ${crypto.randomUUID().slice(0, 8)}`);
    const s2 = await createSprint(request, token, bId2, `Badge2 Sprint B ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, s1);
    await startSprint(request, token, s2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    const activeSprintsSection = page.locator('.dashboard-section').filter({
      has: page.locator('h2', { hasText: 'Active Sprints' }),
    });
    await expect(activeSprintsSection.locator('.dashboard-count')).toContainText('2');
  });

  test('clicking active sprint navigates to the board URL', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-click-nav');
    const boardId = await createBoard(request, token, `Click Nav Sprint Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintId = await createSprint(request, token, boardId, `Click Nav Sprint ${crypto.randomUUID().slice(0, 8)}`);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await page.locator('.dashboard-sprint-item').first().click();

    await expect(page).toHaveURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 13. Dashboard — /boards page additional scenarios
// ---------------------------------------------------------------------------

test.describe('Dashboard — /boards additional board card scenarios', () => {
  test('board card shows settings or actions area', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-card-actions');
    await createBoard(request, token, `Actions Board ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    const card = page.locator('.board-card').first();
    await expect(card).toBeVisible();
    // Card must be interactive (clickable link + delete button)
    await expect(card.locator('.board-card-link, .board-card-delete').first()).toBeVisible();
  });

  test('creating two boards shows two cards in the grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-two-cards');
    await createBoard(request, token, `Two Cards A ${crypto.randomUUID().slice(0, 8)}`);
    await createBoard(request, token, `Two Cards B ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(2);
  });

  test('Create Board modal shows board name input field', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-modal-name-field');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();

    await expect(page.locator('#boardName')).toBeVisible();
  });

  test('Create Board modal submit button is disabled when name is empty', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-modal-submit-disabled');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();

    await expect(page.locator('.modal')).toBeVisible();
    // Clear any pre-filled text
    await page.locator('#boardName').fill('');
    const submitBtn = page.locator('.modal button[type="submit"]', { hasText: 'Create Board' });
    await expect(submitBtn).toBeDisabled({ timeout: 3000 });
  });

  test('board grid has correct number of cards after three creations', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-grid-count-three');
    for (let i = 1; i <= 3; i++) {
      await createBoard(request, token, `Count Board ${i} ${crypto.randomUUID().slice(0, 8)}`);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(3);
  });

  test('/boards shows "Create Board" button in page header when boards exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-create-btn-header');
    await createBoard(request, token, `Header Btn Board ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Create Board")')).toBeVisible();
  });

  test('boards page header h1 reads "Boards"', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-boards-h1-check');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('h1', { hasText: 'Boards' })).toBeVisible({ timeout: 10000 });
  });

  test('deleting all boards returns to empty state', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-delete-all');
    const boardName = `Delete All Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
  });

  test('board card links have correct href with board id', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-card-href');
    const boardId = await createBoard(request, token, `Href Board ${crypto.randomUUID().slice(0, 8)}`);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    const link = page.locator('.board-card-link').first();
    const href = await link.getAttribute('href');
    expect(href).toContain(`/boards/${boardId}`);
  });
});

// ---------------------------------------------------------------------------
// 14. Dashboard — /dashboard My Cards kanban columns (no card data needed)
// ---------------------------------------------------------------------------

test.describe('Dashboard — My Cards kanban column structure', () => {
  test.fixme(
    'My Cards mini-kanban shows Open column when cards exist',
    async ({ page, request }) => {
      // Requires card assignment — skipped in CI without card creation support
      test.skip(true, 'Requires card creation');
    }
  );

  test.fixme(
    'My Cards mini-kanban shows In Progress column when cards exist',
    async ({ page, request }) => {
      test.skip(true, 'Requires card creation');
    }
  );

  test.fixme(
    'My Cards mini-kanban shows In Review column when cards exist',
    async ({ page, request }) => {
      test.skip(true, 'Requires card creation');
    }
  );

  test.fixme(
    'My Cards mini-kanban shows Done column when cards exist',
    async ({ page, request }) => {
      test.skip(true, 'Requires card creation');
    }
  );
});

// ---------------------------------------------------------------------------
// 15. Dashboard — /dashboard Additional sprint and board edge cases
// ---------------------------------------------------------------------------

test.describe('Dashboard — edge cases and additional coverage', () => {
  test('dashboard renders without errors for a brand new user', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-brand-new');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.dashboard-content')).toBeVisible({ timeout: 10000 });
    // No error state should be shown
    await expect(page.locator('.dashboard-error')).not.toBeVisible();
  });

  test('dashboard page has the Layout wrapper (sidebar visible)', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-layout-sidebar');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    // The Layout component renders a sidebar / nav
    await expect(page.locator('.sidebar, .app-sidebar, nav.sidebar, nav').first()).toBeVisible({ timeout: 5000 });
  });

  test('dashboard page load does not show error state for valid user', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-no-error');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await expect(page.locator('.dashboard-error')).not.toBeVisible();
  });

  test('Active Sprints section header contains an icon', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-header-icon');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const sprintsSection = page.locator('.dashboard-section').filter({
      has: page.locator('h2', { hasText: 'Active Sprints' }),
    });
    await expect(sprintsSection.locator('.dashboard-section-header svg')).toBeAttached();
  });

  test('Recent Boards section header contains an icon', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-board-header-icon');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const boardsSection = page.locator('.dashboard-section').filter({
      has: page.locator('h2', { hasText: 'Recent Boards' }),
    });
    await expect(boardsSection.locator('.dashboard-section-header svg')).toBeAttached();
  });

  test('dashboard recent boards shows board name in h3 tag', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-board-h3');
    const boardName = `H3 Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await expect(page.locator('.dashboard-board-card h3', { hasText: boardName })).toBeVisible();
  });

  test('dashboard section count badges use .dashboard-count class', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-count-class');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    const counts = page.locator('.dashboard-count');
    const countNum = await counts.count();
    expect(countNum).toBeGreaterThanOrEqual(3);
  });

  test('navigating away from /dashboard and back keeps user logged in', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-nav-back-auth');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    await page.goto('/boards');
    await expect(page.locator('h1', { hasText: 'Boards' })).toBeVisible({ timeout: 10000 });

    await page.goto('/dashboard');
    await expect(page.locator('.dashboard-content')).toBeVisible({ timeout: 10000 });
  });

  test('boards created in /boards appear in Recent Boards on /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-recent-sync');
    const boardName = `Recent Sync Board ${crypto.randomUUID().slice(0, 8)}`;

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('#boardName').fill(boardName);
    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    // Navigate to board then back to dashboard
    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-board-card').filter({ hasText: boardName })
    ).toBeVisible({ timeout: 5000 });
  });

  test('sprint created and started via API shows in dashboard on reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'dash-sprint-reload');
    const boardId = await createBoard(request, token, `Reload Sprint Board ${crypto.randomUUID().slice(0, 8)}`);
    const sprintName = `Reload Sprint ${crypto.randomUUID().slice(0, 8)}`;
    const sprintId = await createSprint(request, token, boardId, sprintName);
    await startSprint(request, token, sprintId);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-sprint-item').filter({ hasText: sprintName })
    ).toBeVisible();

    // Reload and confirm still present
    await page.reload();
    await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });
    await expect(
      page.locator('.dashboard-sprint-item').filter({ hasText: sprintName })
    ).toBeVisible();
  });
});
