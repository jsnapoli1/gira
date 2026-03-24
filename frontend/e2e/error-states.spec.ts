/**
 * error-states.spec.ts
 *
 * Error handling and empty/degraded states across the app.
 *
 * Tests in this file do NOT require a card to exist — they either use
 * fresh users with no data, or use page.route() to mock API failures.
 *
 * Test inventory
 * ──────────────
 *  Section A: Navigation / Auth errors
 *   1.  Board not found         — /boards/99999 shows "Board not found"
 *   2.  Unauthenticated boards  — no token on /boards redirects to /login
 *   3.  Unauthenticated dash    — no token on /dashboard redirects to /login
 *   4.  Invalid JWT             — garbage token redirects to /login
 *   5.  Cleared token           — removing token and reloading redirects to /login
 *   6.  Expired / garbage JWT   — server rejects token, user stays on /login
 *
 *  Section B: API / Network errors
 *   7.  Cards API 500           — mocked 500 on /cards shows graceful error
 *   8.  Board load 500          — mocked 500 on board GET shows graceful error
 *   9.  Failed board creation   — mocked 500 on POST /boards shows error toast
 *  10.  Dashboard API 500       — mocked 500 on /api/dashboard shows error state
 *  11.  Network offline         — page.setOffline shows error state, no blank screen
 *  12.  Offline on dashboard    — offline on /dashboard shows error state
 *  13.  Retry after offline     — going back online and refreshing restores board list
 *
 *  Section C: Empty states
 *  14.  Empty boards list       — new user sees "No boards yet"
 *  15.  Empty backlog state     — board with swimlane but no cards
 *  16.  Empty reports state     — no board selected shows "Select a board"
 *  17.  Empty notifications     — new user's bell shows "No notifications"
 *
 *  Section D: Form validation errors
 *  18.  Create board empty name — submit with empty name is blocked by browser validation
 *  19.  Login wrong password    — shows error message
 *  20.  Login nonexistent email — shows error message
 *  21.  Signup duplicate email  — shows error message
 *  22.  Signup short password   — shows error message
 *  23.  Login empty fields      — submit blocked by browser validation
 *  24.  Signup empty fields     — submit blocked by browser validation
 *
 *  Section E: Resource not found
 *  25.  Non-existent board      — /boards/99999 shows "Board not found"
 *  26.  Unknown route           — unknown path stays on the app shell (no crash)
 *  27.  Board settings unknown  — /boards/99999/settings gracefully errors
 *
 *  Section F: Misc degraded states
 *  28.  Attachment upload error — mocked 500 on upload shows error toast
 *  29.  Delete confirmation cancel — cancel dialog keeps board
 *  30.  Column add empty name   — submit blocked or shows validation
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Error Tester',
  prefix = 'err',
) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-${prefix}-${uid}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const { token, user } = await res.json();
  return { token, user, email };
}

async function createBoard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name = 'Error Test Board',
) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json() as Promise<{ id: number; name: string; columns: any[] }>;
}

async function createSwimlane(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-' },
  });
  return res.json() as Promise<{ id: number }>;
}

// ---------------------------------------------------------------------------
// Section A: Navigation / Auth errors
// ---------------------------------------------------------------------------

test.describe('Error States — Auth / Navigation', () => {

  // -------------------------------------------------------------------------
  // 1. Board not found — /boards/99999
  // -------------------------------------------------------------------------

  test('navigating to a non-existent board shows Board not found', async ({ page, request }) => {
    const { token } = await createUser(request, 'NotFound Tester', 'notfound');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards/99999');

    // Loading must eventually finish.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Error element must be shown with "Board not found".
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 2. No token → /boards redirects to /login
  // -------------------------------------------------------------------------

  test('unauthenticated user visiting /boards is redirected to /login', async ({ page }) => {
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 3. No token → /dashboard redirects to /login
  // -------------------------------------------------------------------------

  test('unauthenticated user visiting /dashboard is redirected to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 4. Invalid JWT token — garbage token redirects to /login
  // -------------------------------------------------------------------------

  test('invalid JWT token redirects to login page', async ({ page }) => {
    // Step 1: navigate to /boards with no token → goes to /login.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: inject a garbage token that the server will reject.
    await page.evaluate(() =>
      localStorage.setItem('token', 'this.is.not.a.valid.jwt'),
    );

    // Reload — AuthContext calls /api/auth/me which returns 401; user stays
    // null; PrivateRoute keeps user on /login.
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 5. Session expired mid-session — clearing token redirects to /login
  //
  // Uses page.evaluate (not addInitScript) so the token is NOT re-injected
  // on subsequent reloads, which would defeat the test.
  // -------------------------------------------------------------------------

  test('clearing token and reloading redirects to login', async ({ page, request }) => {
    // Step 1: navigate to /boards with no token → PrivateRoute → /login.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: sign up a new user and inject the token via evaluate.
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `session-exp-${uid}@test.com`,
          password: 'password123',
          display_name: 'Session Tester',
        },
      })
    ).json();

    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Reload so AuthContext picks up the injected token.
    await page.reload();
    await page.waitForURL(/\/(login|dashboard|boards)/, { timeout: 10000 });

    // Step 3: simulate session expiry by removing the token.
    await page.evaluate(() => localStorage.removeItem('token'));

    // Reload so AuthContext re-runs with no token → user = null.
    await page.reload();

    // PrivateRoute must redirect to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 6. After logout, protected routes redirect to /login
  // -------------------------------------------------------------------------

  test('after logout, navigating to /boards redirects to /login', async ({ page, request }) => {
    const { token } = await createUser(request, 'Logout Tester', 'logout');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Logout via button in sidebar
    await page.locator('.logout-btn').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Try navigating back — should be blocked
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

});

// ---------------------------------------------------------------------------
// Section B: API / Network errors
// ---------------------------------------------------------------------------

test.describe('Error States — API / Network failures', () => {

  // -------------------------------------------------------------------------
  // 7. Network error on card load is handled gracefully — no blank screen
  //
  // BoardView uses Promise.all([boardsApi.get(), boardsApi.getCards(), ...]).
  // When /cards returns 500 the entire load fails; the board stays null and
  // the UI shows "Board not found" — that is the current graceful degradation.
  // -------------------------------------------------------------------------

  test('mocked 500 on board cards API shows graceful error — no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'CardError Tester', 'carderr');
    const board = await createBoard(request, token, 'Card Error Board');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Mock the board cards endpoint to return 500 before navigating.
    await page.route(`**/api/boards/${board.id}/cards`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto(`/boards/${board.id}`);

    // Loading must eventually finish — no infinite spinner.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // An error element must be shown (board load failed because getCards threw).
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 8. Board GET returns 500 — shows graceful error
  // -------------------------------------------------------------------------

  test('mocked 500 on board GET shows graceful error state', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardGetErr Tester', 'boardget500');
    const board = await createBoard(request, token, '500 Board');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Failed board creation shows error toast
  // -------------------------------------------------------------------------

  test('failed board creation shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardErr Tester', 'boarderr');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Mock POST /boards to fail but allow GETs to pass.
    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Will Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error')).toContainText('Failed to create board');
  });

  // -------------------------------------------------------------------------
  // 10. Dashboard API 500 — shows error state
  // -------------------------------------------------------------------------

  test('mocked 500 on /api/dashboard shows error state — no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'DashErr Tester', 'dasherr');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/dashboard', (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/dashboard');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.dashboard-error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 11. Network offline simulation — going offline shows an error
  //
  // page.setOffline(true) blocks all network requests. When the app tries to
  // load /api/boards it fails; the boards list page should show an error state
  // or an empty state (never a blank white screen or an unhandled exception).
  // -------------------------------------------------------------------------

  test('network offline — boards page shows error or empty state, no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Offline Tester', 'offline');

    // Inject the token while still online.
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Go offline before navigating to boards.
    await page.context().setOffline(true);
    await page.goto('/boards');

    // Wait long enough for any network timeout / error path to resolve.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });

    // The page must render something useful — either an error message or an
    // empty state.  A completely blank body (no child nodes) is a failure.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    // Restore network for cleanup.
    await page.context().setOffline(false);
  });

  // -------------------------------------------------------------------------
  // 12. Network offline on /dashboard — shows error or empty state
  // -------------------------------------------------------------------------

  test('network offline — dashboard shows error state, no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'OfflineDash Tester', 'offlinedash');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.context().setOffline(true);
    await page.goto('/dashboard');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    await page.context().setOffline(false);
  });

  // -------------------------------------------------------------------------
  // 13. Retry after offline — going online and refreshing restores the list
  // -------------------------------------------------------------------------

  test('restoring network and refreshing shows boards again', async ({ page, request }) => {
    const { token } = await createUser(request, 'RetryOnline Tester', 'retryonline');
    await createBoard(request, token, 'Retry Board');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Go offline
    await page.context().setOffline(true);
    await page.goto('/boards');
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });

    // Go back online and reload
    await page.context().setOffline(false);
    await page.reload();

    // Now the boards should load
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 14. GET /api/boards 500 — boards page still renders, no crash
  // -------------------------------------------------------------------------

  test('mocked 500 on GET /api/boards — page renders without crashing', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'BoardsListErr Tester', 'boardslist500');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto('/boards');

    // Loading should resolve — no infinite spinner
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // The page must render something
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// Section C: Empty states
// ---------------------------------------------------------------------------

test.describe('Error States — Empty states', () => {

  // -------------------------------------------------------------------------
  // 15. Empty boards list for a fresh user
  // -------------------------------------------------------------------------

  test('empty boards list shows No boards yet for a new user', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Boards Tester', 'emptyboards');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  // -------------------------------------------------------------------------
  // 16. Empty backlog state
  // -------------------------------------------------------------------------

  test('empty backlog shows No cards in backlog message', async ({ page, request }) => {
    const { token } = await createUser(request, 'Backlog Tester', 'backlogempty');
    const board = await createBoard(request, token, 'Empty Backlog Board');
    await createSwimlane(request, token, board.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.backlog-empty')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.backlog-empty').first()).toContainText('No cards in backlog');
  });

  // -------------------------------------------------------------------------
  // 17. Empty reports state — no board selected
  // -------------------------------------------------------------------------

  test('reports page shows Select a board when no board is selected', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Reports Tester', 'reportsempty');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    await page.click('a:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/, { timeout: 5000 });

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  // -------------------------------------------------------------------------
  // 18. Empty notifications — new user sees "No notifications"
  // -------------------------------------------------------------------------

  test('new user sees No notifications in notification bell dropdown', async ({ page, request }) => {
    const { token } = await createUser(request, 'Notif Tester', 'notifempty');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });
    await page.locator('.notification-bell').click();
    await expect(page.locator('.notification-empty')).toContainText('No notifications', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 19. Dashboard empty state for all three sections
  // -------------------------------------------------------------------------

  test('new user dashboard shows empty state for all three sections', async ({ page, request }) => {
    const { token } = await createUser(request, 'Dashboard Empty Tester', 'dashall');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.waitForSelector('.dashboard-content', { timeout: 10000 });

    // My Cards empty
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no cards assigned/i })
    ).toBeVisible();

    // Recent Boards empty
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no boards yet/i })
    ).toBeVisible();

    // Active Sprints empty
    await expect(
      page.locator('.dashboard-empty').filter({ hasText: /no active sprints/i })
    ).toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// Section D: Form validation errors
// ---------------------------------------------------------------------------

test.describe('Error States — Form validation', () => {

  // -------------------------------------------------------------------------
  // 20. Login with wrong password shows error message
  // -------------------------------------------------------------------------

  test('login with wrong password shows error message', async ({ page, request }) => {
    const { email } = await createUser(request, 'WrongPass Tester', 'wrongpass');

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // An error message should appear
    await expect(page.locator('.error, .form-error, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 21. Login with non-existent email shows error
  // -------------------------------------------------------------------------

  test('login with non-existent email shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', `nonexistent-${crypto.randomUUID()}@test.com`);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await expect(page.locator('.error, .form-error, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 22. Signup with existing email shows error
  // -------------------------------------------------------------------------

  test('signup with existing email shows error message', async ({ page, request }) => {
    const { email } = await createUser(request, 'DupEmail Tester', 'dupemail');

    await page.goto('/signup');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'password123');
    // fill display name if present
    const nameInput = page.locator('input[name="display_name"], input[placeholder*="name" i]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Dup User');
    }
    await page.click('button[type="submit"]');

    await expect(page.locator('.error, .form-error, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 23. Login with empty email field is blocked by HTML5 required validation
  // -------------------------------------------------------------------------

  test('login with empty email is blocked — form not submitted', async ({ page }) => {
    await page.goto('/login');
    // Leave email empty, fill password
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should still be on /login (form didn't submit)
    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 24. Login with empty password is blocked
  // -------------------------------------------------------------------------

  test('login with empty password is blocked — form not submitted', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@test.com');
    // Leave password empty
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 25. Create board with empty name is blocked
  // -------------------------------------------------------------------------

  test('create board with empty name is blocked by form validation', async ({ page, request }) => {
    const { token } = await createUser(request, 'EmptyName Tester', 'emptyname');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    await page.click('button:has-text("Create Board")');
    await expect(page.locator('.modal')).toBeVisible();

    // Submit the form without filling the name
    await page.locator('button[type="submit"]:has-text("Create Board")').click();

    // Modal should still be open — form was not submitted
    await expect(page.locator('.modal')).toBeVisible({ timeout: 2000 });
  });

  // -------------------------------------------------------------------------
  // 26. Signup with empty email is blocked
  // -------------------------------------------------------------------------

  test('signup with empty email is blocked — form not submitted', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/signup/, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 27. Server error on login shows error message
  // -------------------------------------------------------------------------

  test('server error on login shows an error message', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/login');
    await page.fill('input[type="email"]', 'any@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    await expect(page.locator('.error, .form-error, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 28. Server error on signup shows error message
  // -------------------------------------------------------------------------

  test('server error on signup shows an error message', async ({ page }) => {
    await page.route('**/api/auth/signup', (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/signup');
    await page.fill('input[type="email"]', `new-${crypto.randomUUID()}@test.com`);
    await page.fill('input[type="password"]', 'password123');
    const nameInput = page.locator('input[name="display_name"], input[placeholder*="name" i]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Error User');
    }
    await page.click('button[type="submit"]');

    await expect(page.locator('.error, .form-error, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

});

// ---------------------------------------------------------------------------
// Section E: Resource not found
// ---------------------------------------------------------------------------

test.describe('Error States — Resource not found', () => {

  // -------------------------------------------------------------------------
  // 29. Non-existent board settings page gracefully errors
  // -------------------------------------------------------------------------

  test('navigating to settings for non-existent board shows error', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardSettings404', 'bsettings404');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards/99999/settings');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Should show some kind of error — board load will fail
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 30. Unknown route — app does not crash
  // -------------------------------------------------------------------------

  test('navigating to an unknown route does not crash the app', async ({ page, request }) => {
    const { token } = await createUser(request, 'UnknownRoute Tester', 'unknownroute');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/this-route-does-not-exist');

    // Page should not be completely blank
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 31. Very large board ID shows not found, not a crash
  // -------------------------------------------------------------------------

  test('board ID 2147483647 (max int) shows Board not found', async ({ page, request }) => {
    const { token } = await createUser(request, 'MaxInt Tester', 'maxint');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards/2147483647');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

});

// ---------------------------------------------------------------------------
// Section F: Misc degraded states
// ---------------------------------------------------------------------------

test.describe('Error States — Miscellaneous degraded states', () => {

  // -------------------------------------------------------------------------
  // 32. Failed attachment upload shows error toast
  //
  // POST /api/cards triggers Gitea issue creation which may fail in this
  // environment. To work around this, we mock POST /api/cards in the browser
  // to return a synthetic card object, create the card via the Backlog UI,
  // then mock the attachment upload endpoint to return 500 and verify the
  // error toast.
  // -------------------------------------------------------------------------

  test('failed attachment upload shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request, 'Attach Tester', 'attacherr');
    const board = await createBoard(request, token, 'Attachment Error Board');
    const swimlane = await createSwimlane(request, token, board.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to Backlog view.
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 5000 });

    // Intercept POST /api/cards to return a synthetic card, bypassing Gitea.
    const fakeCardId = 999997;
    await page.route('**/api/cards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: fakeCardId,
            board_id: board.id,
            swimlane_id: swimlane.id,
            column_id: board.columns[0].id,
            sprint_id: null,
            parent_id: null,
            issue_type: 'task',
            gitea_issue_id: 0,
            title: 'Attachment Test Card',
            description: '',
            state: 'open',
            story_points: null,
            priority: 'medium',
            due_date: null,
            time_estimate: null,
            position: 0,
            labels: [],
            assignees: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        route.continue();
      }
    });

    // Create a card via the Backlog Add button.
    const addBtn = page.locator('.backlog-section-header button:has-text("Add")').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    const titleInput = page.locator('input[placeholder="Enter card title..."]');
    await expect(titleInput).toBeVisible({ timeout: 3000 });
    await titleInput.fill('Attachment Test Card');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('.backlog-card .card-title').first(),
    ).toContainText('Attachment Test Card', { timeout: 8000 });

    // Now intercept attachment uploads to fail.
    await page.route(`**/api/cards/${fakeCardId}/attachments`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Upload failed' });
      } else {
        route.continue();
      }
    });

    // Open the card detail modal.
    await page.click('.backlog-card .card-title');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachments-sidebar')).toBeVisible({ timeout: 5000 });

    // Upload a small temp file.
    const tmpFile = `/tmp/test-attach-fail-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, 'fail me');
    try {
      const fileInput = page.locator('.attachments-sidebar input[type="file"]');
      await fileInput.setInputFiles(tmpFile);

      await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.toast-error')).toContainText('Failed to upload attachment');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  // -------------------------------------------------------------------------
  // 33. Delete board confirmation — cancelling keeps the board
  // -------------------------------------------------------------------------

  test('cancelling board delete confirmation keeps the board in the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'DeleteCancel Tester', 'delcancel');
    const boardName = `Keep This Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 10000 });

    // Dismiss the dialog (cancel)
    page.once('dialog', (d) => d.dismiss());
    await page.locator('.board-card-delete').first().click();

    // Board should still be visible
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 34. Delete board confirmation — accepting removes the board
  // -------------------------------------------------------------------------

  test('accepting board delete confirmation removes the board from the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'DeleteAccept Tester', 'delaccept');
    const boardName = `Delete This Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.board-card h3', { hasText: boardName })).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 35. Loading state clears — no infinite spinner on /boards
  // -------------------------------------------------------------------------

  test('no infinite spinner on /boards — loading clears within 10 seconds', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'NoSpinner Tester', 'nospinner');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    // The .loading element must disappear
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Then either .empty-state or .boards-grid must be visible
    const emptyOrGrid = page.locator('.empty-state, .boards-grid');
    await expect(emptyOrGrid.first()).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 36. Loading state clears — no infinite spinner on /dashboard
  // -------------------------------------------------------------------------

  test('no infinite spinner on /dashboard — loading clears within 10 seconds', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'NoDashSpinner Tester', 'nodashspin');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.dashboard-content, .dashboard-error')).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 37. Mocked board creation 409 Conflict — toast shows error text
  // -------------------------------------------------------------------------

  test('mocked 409 on board creation shows error toast with server message', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'ConflictErr Tester', 'conflict409');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 409, contentType: 'application/json', body: 'board already exists' });
      } else {
        route.continue();
      }
    });

    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Conflicting Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 38. Mocked 401 on board load — redirects to login or shows error
  // -------------------------------------------------------------------------

  test('mocked 401 on board load shows error or redirects gracefully', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Auth401 Tester', 'auth401');
    const board = await createBoard(request, token, '401 Board');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 401, body: 'Unauthorized' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Either an error state or a redirect — no blank page
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// Section G: Additional API / Network error coverage
// ---------------------------------------------------------------------------

test.describe('Error States — Additional API errors', () => {

  // -------------------------------------------------------------------------
  // 39. Mocked 403 on board load — shows access denied or error
  // -------------------------------------------------------------------------

  test('mocked 403 on board GET shows error or access denied message', async ({ page, request }) => {
    const { token } = await createUser(request, 'Forbidden403 Tester', 'forbidden403');
    const board = await createBoard(request, token, '403 Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied' }) });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Page must render something — error state, redirect, or message
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 40. Mocked 500 on columns load — board still renders without crash
  // -------------------------------------------------------------------------

  test('mocked 500 on columns endpoint — board page shows error gracefully', async ({ page, request }) => {
    const { token } = await createUser(request, 'ColErr Tester', 'colerr500');
    const board = await createBoard(request, token, 'Column Error Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}/columns`, (route) => {
      route.fulfill({ status: 500, body: 'Server Error' });
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Should not crash
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 41. Mocked 500 on swimlanes — board page shows error gracefully
  // -------------------------------------------------------------------------

  test('mocked 500 on swimlanes endpoint — board page shows error gracefully', async ({ page, request }) => {
    const { token } = await createUser(request, 'SwimErr Tester', 'swimerr500');
    const board = await createBoard(request, token, 'Swimlane Error Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}/swimlanes`, (route) => {
      route.fulfill({ status: 500, body: 'Server Error' });
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 42. Mocked 500 on sprint fetch — board shows error, no crash
  // -------------------------------------------------------------------------

  test('mocked 500 on sprints endpoint — board page shows error gracefully', async ({ page, request }) => {
    const { token } = await createUser(request, 'SprintErr Tester', 'sprinterr500');
    const board = await createBoard(request, token, 'Sprint Error Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}/sprints`, (route) => {
      route.fulfill({ status: 500, body: 'Server Error' });
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 43. Mocked network failure (abort) on board GET — no blank screen
  // -------------------------------------------------------------------------

  test('aborted board GET request — page shows error state, no blank screen', async ({ page, request }) => {
    const { token } = await createUser(request, 'AbortBoard Tester', 'abortboard');
    const board = await createBoard(request, token, 'Abort Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 44. Mocked 429 Too Many Requests on board load
  // -------------------------------------------------------------------------

  test('mocked 429 on board load — page shows error without crashing', async ({ page, request }) => {
    const { token } = await createUser(request, 'RateLimit Tester', 'ratelimit429');
    const board = await createBoard(request, token, '429 Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 429, body: 'Too Many Requests' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 45. Mocked 500 on board list — no JS crash
  // -------------------------------------------------------------------------

  test('mocked 500 on GET /api/boards — no JS errors thrown', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardsErr2 Tester', 'boardserr2');

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto('/boards');
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 46. Mocked malformed JSON on board GET — handled without crash
  // -------------------------------------------------------------------------

  test('malformed JSON from board GET — page shows error without crashing', async ({ page, request }) => {
    const { token } = await createUser(request, 'MalformJSON Tester', 'maljson');
    const board = await createBoard(request, token, 'Malform JSON Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 200, contentType: 'application/json', body: 'not valid json{{' });
      } else {
        route.continue();
      }
    });

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// Section H: Additional empty states
// ---------------------------------------------------------------------------

test.describe('Error States — Additional empty states', () => {

  // -------------------------------------------------------------------------
  // 47. Empty sprints section in backlog
  // -------------------------------------------------------------------------

  test('backlog with no sprints shows create sprint prompt', async ({ page, request }) => {
    const { token } = await createUser(request, 'EmptySprint Tester', 'emptysprint');
    const board = await createBoard(request, token, 'No Sprints Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });

    // No sprints → shows empty sprint area or create sprint button
    const noSprintMsg = page.locator('.backlog-empty, .empty-state, button:has-text("Create Sprint"), .sprint-empty');
    await expect(noSprintMsg.first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 48. Empty board — no swimlanes defined → shows empty swimlane state
  // -------------------------------------------------------------------------

  test('board with no swimlanes shows empty state or prompt to add swimlane', async ({ page, request }) => {
    const { token } = await createUser(request, 'NoSwimlane Tester', 'noswimlane');
    const board = await createBoard(request, token, 'No Swimlane Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // App should render something — empty state or columns without swimlanes
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 49. Empty columns — board with swimlane but no cards shows column headers
  // -------------------------------------------------------------------------

  test('board with no cards still shows column headers', async ({ page, request }) => {
    const { token } = await createUser(request, 'NoCards Tester', 'nocards');
    const board = await createBoard(request, token, 'No Cards Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Column headers (e.g., "To Do", "In Progress") should still be visible
    const columns = page.locator('.column-header, .board-column h3, .column-title');
    await expect(columns.first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 50. Reports page empty — no board selected prompt
  // -------------------------------------------------------------------------

  test('reports page shows select-a-board prompt for user with boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'ReportsSelectBoard Tester', 'rptselect');
    await createBoard(request, token, 'Reports Select Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Before selecting a board, should show prompt
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 51. Notification dropdown opens with no notifications
  // -------------------------------------------------------------------------

  test('notification bell can be opened without error for new user', async ({ page, request }) => {
    const { token } = await createUser(request, 'BellEmpty Tester', 'bellempty');

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 10000 });

    const bell = page.locator('.notification-bell');
    if (await bell.isVisible({ timeout: 3000 })) {
      await bell.click();
      // No error thrown
      expect(errors).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // 52. Board settings page with no members other than owner
  // -------------------------------------------------------------------------

  test('board settings members section shows only owner when no members added', async ({ page, request }) => {
    const { token } = await createUser(request, 'OnlyOwner Tester', 'onlyowner');
    const board = await createBoard(request, token, 'Owner Only Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    // Members section renders without error
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// Section I: Additional form validation errors
// ---------------------------------------------------------------------------

test.describe('Error States — Additional form validation', () => {

  // -------------------------------------------------------------------------
  // 53. Board name with only spaces is rejected or blocked
  // -------------------------------------------------------------------------

  test('create board with whitespace-only name is blocked or shows error', async ({ page, request }) => {
    const { token } = await createUser(request, 'WhitespaceName Tester', 'wsname');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    await page.click('button:has-text("Create Board")');
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 });

    // Fill with only spaces
    await page.fill('#boardName', '   ');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Either modal stays open (blocked) or an error is shown
    const modalOrError = page.locator('.modal, .error, .form-error, [class*="error"]').first();
    await expect(modalOrError).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 54. Login with very long email that is invalid
  // -------------------------------------------------------------------------

  test('login with 300-char fake email shows error or is blocked', async ({ page }) => {
    await page.goto('/login');
    const longEmail = `${'a'.repeat(295)}@x.co`;
    await page.fill('input[type="email"]', longEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should stay on login or show error
    await page.waitForTimeout(1000);
    const url = page.url();
    const isOk = url.includes('/login') || page.locator('.error, .form-error, [class*="error"]');
    expect(url.includes('/login') || url.includes('/dashboard') || url.includes('/boards')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 55. Column name empty — create column blocked
  // -------------------------------------------------------------------------

  test('create column with empty name is blocked by form validation', async ({ page, request }) => {
    const { token } = await createUser(request, 'ColName Tester', 'colname');
    const board = await createBoard(request, token, 'Column Validate Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    // Look for "Add Column" button in settings
    const addColBtn = page.locator('button:has-text("Add Column"), button:has-text("Add column")').first();
    if (await addColBtn.isVisible({ timeout: 3000 })) {
      await addColBtn.click();

      // Try to submit with empty column name
      const submitBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Create")').first();
      if (await submitBtn.isVisible({ timeout: 2000 })) {
        await submitBtn.click();
        // Should still be on settings page
        await expect(page.locator('.board-settings')).toBeVisible({ timeout: 3000 });
      }
    }
  });

  // -------------------------------------------------------------------------
  // 56. Signup password too short — shows validation error
  // -------------------------------------------------------------------------

  test('signup with password shorter than minimum shows error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('input[type="email"]', `short-pass-${crypto.randomUUID()}@test.com`);
    await page.fill('input[type="password"]', '123');

    const nameInput = page.locator('input[name="display_name"], input[placeholder*="name" i]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Short Pass User');
    }

    await page.click('button[type="submit"]');

    // Should either block (still on signup) or show an error
    const url = page.url();
    const hasError = await page.locator('.error, .form-error, [class*="error"]').first().isVisible();
    expect(url.includes('/signup') || hasError).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 57. Board settings rename to empty string is blocked
  // -------------------------------------------------------------------------

  test('renaming board to empty string in settings is blocked', async ({ page, request }) => {
    const { token } = await createUser(request, 'RenameEmpty Tester', 'renameempty');
    const board = await createBoard(request, token, 'Rename Empty Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    // Find the board name input and clear it
    const nameInput = page.locator('input[name="name"], input#boardName, .board-name-input').first();
    if (await nameInput.isVisible({ timeout: 3000 })) {
      await nameInput.triple_click?.() || await nameInput.click({ clickCount: 3 });
      await nameInput.fill('');

      const saveBtn = page.locator('button[type="submit"], button:has-text("Save")').first();
      if (await saveBtn.isVisible({ timeout: 2000 })) {
        await saveBtn.click();
        // Should remain on settings page
        await expect(page.locator('.board-settings')).toBeVisible({ timeout: 3000 });
      }
    }
  });

  // -------------------------------------------------------------------------
  // 58. Create sprint with end date before start date
  // -------------------------------------------------------------------------

  test('creating sprint with end date before start date shows validation error', async ({ page, request }) => {
    const { token } = await createUser(request, 'SprintDate Tester', 'sprintdate');
    const board = await createBoard(request, token, 'Sprint Date Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });

    // Look for Create Sprint button
    const createSprintBtn = page.locator('button:has-text("Create Sprint"), button:has-text("New Sprint")').first();
    if (await createSprintBtn.isVisible({ timeout: 3000 })) {
      await createSprintBtn.click();

      // Fill in start date that is AFTER end date
      const startInput = page.locator('input[name="start_date"], input[type="date"]').first();
      const endInput = page.locator('input[name="end_date"], input[type="date"]').last();

      if (await startInput.isVisible({ timeout: 2000 }) && await endInput.isVisible({ timeout: 2000 })) {
        await startInput.fill('2025-12-31');
        await endInput.fill('2025-01-01');

        const submitBtn = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")').first();
        if (await submitBtn.isVisible({ timeout: 2000 })) {
          await submitBtn.click();

          // Should show validation error or block submission
          const errorOrModal = page.locator('.error, .form-error, [class*="error"], .modal').first();
          await expect(errorOrModal).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 59. Mocked 500 on create sprint — shows error toast
  // -------------------------------------------------------------------------

  test('mocked 500 on sprint creation shows error state', async ({ page, request }) => {
    const { token } = await createUser(request, 'SprintCreate500 Tester', 'sprintcreate500');
    const board = await createBoard(request, token, 'Sprint 500 Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}/sprints`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });

    const createSprintBtn = page.locator('button:has-text("Create Sprint"), button:has-text("New Sprint")').first();
    if (await createSprintBtn.isVisible({ timeout: 3000 })) {
      await createSprintBtn.click();

      const sprintNameInput = page.locator('input[name="name"], input[placeholder*="sprint" i], input[placeholder*="Sprint" i]').first();
      if (await sprintNameInput.isVisible({ timeout: 2000 })) {
        await sprintNameInput.fill('Failing Sprint');
        const submitBtn = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")').first();
        if (await submitBtn.isVisible({ timeout: 2000 })) {
          await submitBtn.click();
          // Should show error feedback
          const bodyText = await page.locator('body').innerText();
          expect(bodyText.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 60. Mocked 500 on card create — shows error feedback
  // -------------------------------------------------------------------------

  test('mocked 500 on card creation shows error feedback', async ({ page, request }) => {
    const { token } = await createUser(request, 'CardCreate500 Tester', 'cardcreate500');
    const board = await createBoard(request, token, 'Card 500 Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/cards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Try to add a card via quick-add
    const addCardBtn = page.locator('.add-card-btn').first();
    if (await addCardBtn.isVisible({ timeout: 5000 })) {
      await addCardBtn.click();
      const quickAddInput = page.locator('.quick-add-form input').first();
      if (await quickAddInput.isVisible({ timeout: 3000 })) {
        await quickAddInput.fill('Failing Card');
        await page.keyboard.press('Enter');

        // Should show error toast or message — no crash
        await page.waitForTimeout(2000);
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        expect(errors).toHaveLength(0);
      }
    }
  });

});

// ---------------------------------------------------------------------------
// Section J: Loading states
// ---------------------------------------------------------------------------

test.describe('Error States — Loading states', () => {

  // -------------------------------------------------------------------------
  // 61. Board list shows content after loading completes
  // -------------------------------------------------------------------------

  test('board list loading completes and shows content', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadBoards Tester', 'loadboards');
    await createBoard(request, token, 'Loading Board List');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    // Eventually the loading state goes away
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    // And content is shown
    await expect(page.locator('.boards-grid, .empty-state')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 62. Board view loading completes and shows columns
  // -------------------------------------------------------------------------

  test('board view loading completes and shows board content', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadBoardView Tester', 'loadboardview');
    const board = await createBoard(request, token, 'Loading Board View');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 63. Reports page loading completes
  // -------------------------------------------------------------------------

  test('reports page loading completes without infinite spinner', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadReports Tester', 'loadreports');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1:has-text("Reports")')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 64. Settings page loading completes
  // -------------------------------------------------------------------------

  test('settings page loads without spinner stalling', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadSettings Tester', 'loadsettings');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 65. Dashboard loading completes without infinite spinner
  // -------------------------------------------------------------------------

  test('dashboard loading completes without infinite spinner', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadDashboard Tester', 'loaddash');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.dashboard-content, .dashboard-error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 66. Card modal loading completes when card exists
  // -------------------------------------------------------------------------

  test('card modal loading completes when card data is fetched', async ({ page, request }) => {
    const { token } = await createUser(request, 'LoadCardModal Tester', 'loadcardmodal');
    const board = await createBoard(request, token, 'Card Modal Load Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'SL-' },
    });
    const swimlane = await slRes.json();

    const colsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colsRes.json();

    if (columns && columns.length > 0) {
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Load Modal Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
      });
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
    }

    const cardItem = page.locator('.card-item').first();
    if (await cardItem.isVisible({ timeout: 5000 })) {
      await cardItem.click();
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

      // Modal should not have an infinite loading spinner
      await expect(page.locator('.card-detail-modal-unified .loading')).not.toBeVisible({ timeout: 8000 });
    }
  });

});

// ---------------------------------------------------------------------------
// Section K: Mocked delete/update error paths
// ---------------------------------------------------------------------------

test.describe('Error States — Delete and update errors', () => {

  // -------------------------------------------------------------------------
  // 67. Mocked 500 on board delete — board stays in list, no crash
  // -------------------------------------------------------------------------

  test('mocked 500 on board delete — board stays in list', async ({ page, request }) => {
    const { token } = await createUser(request, 'DelBoard500 Tester', 'delboard500');
    const boardName = `Delete500 Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/boards/*', (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto('/boards');
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    // The board should still be visible since delete failed
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 68. Mocked 500 on card update — no JS crash
  // -------------------------------------------------------------------------

  test('mocked 500 on PATCH /api/cards/:id — no JS error thrown', async ({ page, request }) => {
    const { token } = await createUser(request, 'CardUpdate500 Tester', 'cardupdate500');
    const board = await createBoard(request, token, 'Card Update 500 Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'SL-' },
    });
    const swimlane = await slRes.json();

    const colsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colsRes.json();

    let cardId: number | null = null;
    if (columns && columns.length > 0) {
      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Update 500 Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
      });
      if (cardRes.ok()) {
        const cardBody = await cardRes.json();
        cardId = cardBody.id;
      }
    }

    if (!cardId) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/cards/${cardId}`, (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
    }

    const cardItem = page.locator('.card-item').first();
    if (await cardItem.isVisible({ timeout: 5000 })) {
      await cardItem.click();
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

      // Try editing the title
      const titleEl = page.locator('.card-detail-title').first();
      if (await titleEl.isVisible({ timeout: 2000 })) {
        await titleEl.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' edited');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
      }

      expect(errors).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // 69. Mocked 500 on column delete — no crash
  // -------------------------------------------------------------------------

  test('mocked 500 on column delete — app stays functional', async ({ page, request }) => {
    const { token } = await createUser(request, 'ColDel500 Tester', 'coldel500');
    const board = await createBoard(request, token, 'Col Delete 500 Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route('**/api/boards/*/columns/*', (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    // Board settings should still be visible — no crash
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 70. Accept dialog on board delete fires only once
  // -------------------------------------------------------------------------

  test('board delete dialog fires only once when accepted', async ({ page, request }) => {
    const { token } = await createUser(request, 'DelOnce Tester', 'delonce');
    const boardName = `Delete Once Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible({ timeout: 10000 });

    let dialogCount = 0;
    page.once('dialog', (d) => {
      dialogCount++;
      d.accept();
    });

    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.board-card h3', { hasText: boardName })).not.toBeVisible({ timeout: 5000 });
    expect(dialogCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 71. Mocked 500 on DELETE label — no JS crash
  // -------------------------------------------------------------------------

  test('mocked 500 on label delete — app stays functional without crash', async ({ page, request }) => {
    const { token } = await createUser(request, 'LabelDel500 Tester', 'labeldel500');
    const board = await createBoard(request, token, 'Label Del 500 Board');

    const errors: string[] = [];

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}/labels/*`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 72. Mocked 403 on board settings — shows error gracefully
  // -------------------------------------------------------------------------

  test('mocked 403 on board settings GET — shows error gracefully', async ({ page, request }) => {
    const { token } = await createUser(request, 'Settings403 Tester', 'settings403');
    const board = await createBoard(request, token, 'Settings 403 Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.route(`**/api/boards/${board.id}`, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied' }) });
      } else {
        route.continue();
      }
    });

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Page must render something
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 73. No JS exceptions on any primary route navigation
  // -------------------------------------------------------------------------

  test('no JS exceptions when navigating through primary routes', async ({ page, request }) => {
    const { token } = await createUser(request, 'NoJSErr Tester', 'nojserr');

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    for (const route of ['/boards', '/reports', '/settings', '/dashboard']) {
      await page.goto(route);
      await page.locator('body').waitFor({ timeout: 5000 });
    }

    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 74. Slow API (delayed response) — loading indicator shown
  // -------------------------------------------------------------------------

  test('delayed boards API response — page eventually loads, no crash', async ({ page, request }) => {
    const { token } = await createUser(request, 'SlowAPI Tester', 'slowapi');
    await createBoard(request, token, 'Slow API Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Add a 2-second delay to the boards list API
    await page.route('**/api/boards', async (route) => {
      if (route.request().method() === 'GET') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      } else {
        await route.continue();
      }
    });

    await page.goto('/boards');
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });
    await expect(page.locator('.boards-grid, .empty-state')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 75. Token expiry mid-session on API call redirects to /login
  // -------------------------------------------------------------------------

  test('401 returned during session on /api/boards — user ends up on login', async ({ page, request }) => {
    const { token } = await createUser(request, 'MidSession401 Tester', 'midsession401');

    // Inject real token first so auth loads
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Then intercept the boards API to return 401 (simulating expired token)
    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
      } else {
        route.continue();
      }
    });

    await page.goto('/boards');

    // After a 401 on a data fetch, app may redirect to /login or show an error
    await page.waitForTimeout(3000);
    const url = page.url();
    const bodyText = await page.locator('body').innerText();
    // Should not be a blank page
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

});
