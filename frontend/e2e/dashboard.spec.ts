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

    await expect(page.locator('.dashboard-content'), ).toBeVisible({ timeout: 10000 });
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
});

// ---------------------------------------------------------------------------
// 5. /dashboard page structure
// ---------------------------------------------------------------------------

test.describe('Dashboard — /dashboard page sections', () => {
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
});

// ---------------------------------------------------------------------------
// 8. My Cards section on /dashboard (requires card creation — fixme)
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
});
