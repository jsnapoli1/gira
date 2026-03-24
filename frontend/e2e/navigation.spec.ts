import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, prefix = 'nav') {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Nav Test User' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

async function createBoard(request: any, token: string, name: string) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Sidebar structure
// ---------------------------------------------------------------------------

test.describe('Navigation — sidebar structure', () => {
  test('sidebar is visible on /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-sidebar');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
  });

  test('sidebar contains Dashboard, Boards, Reports, Settings nav items', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-items');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.nav-item', { hasText: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'Boards' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'Reports' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'Settings' })).toBeVisible();
  });

  test('sidebar shows the logged-in user display name', async ({ page, request }) => {
    const email = `test-nav-name-${crypto.randomUUID()}@test.com`;
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Nav Display Name' },
    });
    const { token } = await res.json();
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.user-name')).toContainText('Nav Display Name', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Navigate to /boards
// ---------------------------------------------------------------------------

test.describe('Navigation — /boards page', () => {
  test('navigating to /boards when authenticated lands on boards page', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-boards');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('Boards nav item is active when on /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-boards-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.nav-item.active')).toContainText('Boards', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Navigate to /reports
// ---------------------------------------------------------------------------

test.describe('Navigation — /reports page', () => {
  test('clicking Reports nav item navigates to /reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-reports');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('.nav-item', { hasText: 'Reports' }).click();

    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });
  });

  test('Reports page renders an h1 heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-reports-h1');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('h1:has-text("Reports")')).toBeVisible({ timeout: 10000 });
  });

  test('Reports nav item is active when on /reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-reports-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('.nav-item.active')).toContainText('Reports', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Navigate to /settings
// ---------------------------------------------------------------------------

test.describe('Navigation — /settings page', () => {
  test('clicking Settings nav item navigates to /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-settings');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('.nav-item', { hasText: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('Settings page renders an h1 heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-settings-h1');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
  });

  test('Settings nav item is active when on /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-settings-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.nav-item.active')).toContainText('Settings', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Navigate to /dashboard
// ---------------------------------------------------------------------------

test.describe('Navigation — /dashboard page', () => {
  test('clicking Dashboard nav item navigates to /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-dash');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('.nav-item', { hasText: 'Dashboard' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('Dashboard nav item is active when on /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-dash-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.nav-item.active')).toContainText('Dashboard', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Clicking a board navigates to board view
// ---------------------------------------------------------------------------

test.describe('Navigation — board card click', () => {
  test('clicking a board card link navigates to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-board-click');
    const board = await createBoard(request, token, 'Click Nav Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await page.locator('.board-card-link', { hasText: 'Click Nav Board' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    expect(page.url()).toMatch(new RegExp(`/boards/${board.id}$`));
  });

  test('board view shows the board name in the header', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-board-header');
    const board = await createBoard(request, token, 'Header Name Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-header h1')).toContainText('Header Name Board', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Back button / browser back navigation
// ---------------------------------------------------------------------------

test.describe('Navigation — browser back button', () => {
  test('browser back from board view returns to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-back');
    const board = await createBoard(request, token, 'Back Nav Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'Back Nav Board' }).click();
    await page.waitForURL(/\/boards\/\d+$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('clicking Boards nav item from board view returns to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-back-sidebar');
    const board = await createBoard(request, token, 'Sidebar Back Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Boards' }).click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Logo / home link
// ---------------------------------------------------------------------------

test.describe('Navigation — logo link', () => {
  test('clicking the logo navigates to /dashboard (root redirect)', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-logo');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('.logo').click();

    // / redirects to /dashboard per App.tsx
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Navigation — logout', () => {
  test('clicking the logout button navigates to /login', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-logout');
    // Use page.evaluate (not addInitScript) so token is not re-injected after logout
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.logout-btn').click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('after logout, visiting /boards redirects to /login', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-logout-redirect');
    // Use page.evaluate (not addInitScript) so the token is NOT re-injected on subsequent navigations
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.logout-btn').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Now navigate back — token was removed by logout, so PrivateRoute should redirect
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated redirect
// ---------------------------------------------------------------------------

test.describe('Navigation — unauthenticated redirect', () => {
  test('visiting /boards without a token redirects to /login', async ({ page }) => {
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /reports without a token redirects to /login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /settings without a token redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /dashboard without a token redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting a board view without a token redirects to /login', async ({ page }) => {
    await page.goto('/boards/1');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('clearing localStorage on an authenticated page redirects to /login on reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-clear-storage');
    // Use page.evaluate so the token is not re-injected on subsequent navigations
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => localStorage.clear());
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Multi-page navigation cycle
// ---------------------------------------------------------------------------

test.describe('Navigation — multi-page cycle', () => {
  test('can cycle through Dashboard → Boards → Reports → Settings via sidebar', async ({ page, request }) => {
    const { token } = await createUser(request, 'nav-cycle');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.locator('.nav-item', { hasText: 'Boards' }).click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
    await expect(page.locator('.nav-item.active')).toContainText('Boards');

    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });
    await expect(page.locator('.nav-item.active')).toContainText('Reports');

    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
    await expect(page.locator('.nav-item.active')).toContainText('Settings');

    await page.locator('.nav-item', { hasText: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('.nav-item.active')).toContainText('Dashboard');
  });
});
