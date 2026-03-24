import { test, expect } from '@playwright/test';

const BACKEND = `http://localhost:${process.env.PORT || 9002}`;

/**
 * Helper: Sign up a fresh user via direct API call and inject the token into
 * localStorage so the page loads as that user without going through the signup UI.
 */
async function setupUser(
  { page, request }: { page: import('@playwright/test').Page; request: import('@playwright/test').APIRequestContext },
  prefix = 'dash'
): Promise<{ token: string; userId: number; email: string }> {
  const email = `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const res = await request.post(`${BACKEND}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Dashboard Test User' },
  });
  expect(res.ok(), `signup failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  const token: string = body.token;

  // Inject token before the page loads so AuthContext picks it up
  await page.addInitScript((t) => localStorage.setItem('token', t), token);

  // Fetch user id via /api/auth/me
  const meRes = await request.get(`${BACKEND}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json();

  return { token, userId: me.id, email };
}

/**
 * Helper: Create a board and return its id.
 */
async function createBoard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description: '' },
  });
  expect(res.ok(), `createBoard failed: ${await res.text()}`).toBeTruthy();
  const board = await res.json();
  return board.id;
}

/**
 * Helper: Create a swimlane on a board (required before creating cards).
 */
async function createSwimlane(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      repo_source: 'default_gitea',
      repo_owner: 'test',
      repo_name: 'repo',
      designator: 'T-',
      color: '#6366f1',
    },
  });
  expect(res.ok(), `createSwimlane failed: ${await res.text()}`).toBeTruthy();
  const swimlane = await res.json();
  return swimlane.id;
}

/**
 * Helper: Get the first column of a board.
 */
async function getFirstColumn(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number
): Promise<number> {
  const res = await request.get(`${BACKEND}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `getColumns failed: ${await res.text()}`).toBeTruthy();
  const columns = await res.json();
  expect(columns.length, 'board should have columns').toBeGreaterThan(0);
  return columns[0].id;
}

/**
 * Helper: Create a card and return its id.
 */
async function createCard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      title,
      priority: 'medium',
    },
  });
  expect(res.ok(), `createCard failed: ${await res.text()}`).toBeTruthy();
  const card = await res.json();
  return card.id;
}

/**
 * Helper: Create a sprint and return its id.
 * NOTE: board_id is a query parameter; name/goal are in the JSON body.
 */
async function createSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `createSprint failed: ${await res.text()}`).toBeTruthy();
  const sprint = await res.json();
  return sprint.id;
}

/**
 * Helper: Start a sprint.
 */
async function startSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  sprintId: number
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `startSprint failed: ${await res.text()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------

test.describe('Dashboard', () => {
  test.describe('Page structure', () => {
    test('loads and shows all three section headings', async ({ page, request }) => {
      await setupUser({ page, request }, 'structure');
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-content', { timeout: 10000 });

      await expect(page.locator('h2:has-text("My Cards")')).toBeVisible();
      await expect(page.locator('h2:has-text("Recent Boards")')).toBeVisible();
      await expect(page.locator('h2:has-text("Active Sprints")')).toBeVisible();
    });
  });

  test.describe('Empty states', () => {
    test.beforeEach(async ({ page, request }) => {
      await setupUser({ page, request }, 'empty');
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-content', { timeout: 10000 });
    });

    test('shows empty state for Recent Boards when user has no boards', async ({ page }) => {
      await expect(page.locator('.dashboard-empty').filter({ hasText: /no boards yet/i })).toBeVisible();
    });

    test('shows empty state for Active Sprints when user has no active sprints', async ({ page }) => {
      await expect(page.locator('.dashboard-empty').filter({ hasText: /no active sprints/i })).toBeVisible();
    });

    test('shows empty state for My Cards when user has no assigned cards', async ({ page }) => {
      await expect(page.locator('.dashboard-empty').filter({ hasText: /no cards assigned/i })).toBeVisible();
    });
  });

  test.describe('Recent Boards', () => {
    test('board created via API appears in Recent Boards grid', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'rboard');
      const boardName = `Dashboard Board ${Date.now()}`;
      await createBoard(request, token, boardName);

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });

      await expect(page.locator('.dashboard-board-card').filter({ hasText: boardName })).toBeVisible();
    });

    test('clicking a board card navigates to the board page', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'rboard-nav');
      const boardId = await createBoard(request, token, `Nav Board ${Date.now()}`);

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-boards-grid', { timeout: 10000 });

      await page.locator('.dashboard-board-card').first().click();
      await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
      expect(page.url()).toContain(`/boards/${boardId}`);
    });
  });

  test.describe('Active Sprints', () => {
    test('started sprint appears in Active Sprints list', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'sprint');
      const boardId = await createBoard(request, token, `Sprint Board ${Date.now()}`);
      const sprintName = `Sprint ${Date.now()}`;
      const sprintId = await createSprint(request, token, boardId, sprintName);
      await startSprint(request, token, sprintId);

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });

      await expect(page.locator('.dashboard-sprint-item').filter({ hasText: sprintName })).toBeVisible();
    });

    test('active sprint item links to the board', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'sprint-nav');
      const boardId = await createBoard(request, token, `Sprint Nav Board ${Date.now()}`);
      const sprintId = await createSprint(request, token, boardId, `Sprint Nav ${Date.now()}`);
      await startSprint(request, token, sprintId);

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-sprint-list', { timeout: 10000 });

      await page.locator('.dashboard-sprint-item').first().click();
      await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
      expect(page.url()).toContain(`/boards/${boardId}`);
    });
  });

  test.describe('My Cards', () => {
    test('card assigned to self appears in My Cards Kanban', async ({ page, request }) => {
      const { token, userId } = await setupUser({ page, request }, 'mycard');
      const boardId = await createBoard(request, token, `My Cards Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      const cardTitle = `My Card ${Date.now()}`;
      const cardId = await createCard(request, token, boardId, swimlaneId, columnId, cardTitle);

      // Assign card to self
      const assignRes = await request.post(`${BACKEND}/api/cards/${cardId}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });
      expect(assignRes.ok(), `assignCard failed: ${await assignRes.text()}`).toBeTruthy();

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      await expect(page.locator('.dashboard-kanban-card-title').filter({ hasText: cardTitle })).toBeVisible();
    });

    test('assigned card appears in the correct state column', async ({ page, request }) => {
      const { token, userId } = await setupUser({ page, request }, 'mycard-state');
      const boardId = await createBoard(request, token, `State Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      const cardTitle = `State Card ${Date.now()}`;
      const cardId = await createCard(request, token, boardId, swimlaneId, columnId, cardTitle);

      // Assign card to self
      await request.post(`${BACKEND}/api/cards/${cardId}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      // The first column state is "open" — verify the "Open" column shows the card
      const openColumn = page.locator('.dashboard-kanban-column').filter({ has: page.locator('.dashboard-kanban-column-title:has-text("Open")') });
      await expect(openColumn.locator('.dashboard-kanban-card-title').filter({ hasText: cardTitle })).toBeVisible();
    });

    test('clicking a card in My Cards navigates to the board', async ({ page, request }) => {
      const { token, userId } = await setupUser({ page, request }, 'mycard-nav');
      const boardId = await createBoard(request, token, `Card Nav Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      const cardId = await createCard(request, token, boardId, swimlaneId, columnId, `Nav Card ${Date.now()}`);

      // Assign card to self
      await request.post(`${BACKEND}/api/cards/${cardId}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { user_id: userId },
      });

      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

      await page.locator('.dashboard-kanban-card').first().click();
      // Should navigate to the board URL (with optional ?card= param)
      await page.waitForURL(new RegExp(`/boards/${boardId}`), { timeout: 10000 });
      expect(page.url()).toContain(`/boards/${boardId}`);
    });
  });
});
