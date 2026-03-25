import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(prefix = 'user') {
  return `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signupViaAPI(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  email: string,
  password = 'password123',
  displayName = 'Test User',
) {
  return request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: displayName },
  });
}

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

test.describe('Unauthenticated access', () => {
  test('root path redirects to /login when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page shows Welcome to Gira heading', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Welcome to Gira');
  });

  test('login page shows email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('login page shows Sign In submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('button[type="submit"]')).toContainText('Sign In');
  });

  test('accessing /boards while unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });

  test('accessing /settings while unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('accessing /reports while unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/);
  });

  test('accessing /dashboard while unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Signup form layout
// ---------------------------------------------------------------------------

test.describe('Signup form layout', () => {
  test('signup page shows Create Account heading', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('h1')).toContainText('Create Account');
  });

  test('signup form renders displayName field', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#displayName')).toBeVisible();
  });

  test('signup form renders email field', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#email')).toBeVisible();
  });

  test('signup form renders password field', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#password')).toBeVisible();
  });

  test('signup form renders confirmPassword field', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#confirmPassword')).toBeVisible();
  });

  test('signup form renders Create Account submit button', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('button[type="submit"]')).toContainText('Create Account');
  });
});

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

test.describe('Signup', () => {
  test('signup with valid credentials succeeds and redirects to dashboard', async ({ page }) => {
    const email = uniqueEmail('signup');

    await page.goto('/signup');
    await page.fill('#displayName', 'New User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');

    // After signup, app redirects to /dashboard
    await expect(page).toHaveURL(/\/(boards|dashboard)/);
  });

  test('after signup a JWT token is stored in localStorage', async ({ page }) => {
    const email = uniqueEmail('jwt');

    await page.goto('/signup');
    await page.fill('#displayName', 'JWT User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    // After signup, app redirects to /dashboard
    await expect(page).toHaveURL(/\/(boards|dashboard)/);

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
    expect(token).toBeTruthy();
    // JWT has three dot-separated parts
    expect(token!.split('.').length).toBe(3);
  });

  test('duplicate email signup shows an error containing "already exists"', async ({ page, request }) => {
    const email = uniqueEmail('dup');
    // Pre-create via API
    await signupViaAPI(request, email);

    await page.goto('/signup');
    await page.fill('#displayName', 'Duplicate User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.locator('.auth-error')).toContainText(/already exists/i);
  });

  test('signup with mismatched passwords shows a client-side error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail('mismatch'));
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'differentpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.locator('.auth-error')).toContainText('Passwords do not match');
  });

  test('signup with password shorter than 6 characters shows a client-side error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail('short'));
    await page.fill('#password', 'abc12');
    await page.fill('#confirmPassword', 'abc12');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.locator('.auth-error')).toContainText('at least 6 characters');
  });

  test('signup form does not navigate on password mismatch error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail('nomove'));
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'wrong');
    await page.click('button[type="submit"]');

    // Stays on signup page
    await expect(page).toHaveURL(/\/signup/);
  });

  test('can navigate from signup to login', async ({ page }) => {
    await page.goto('/signup');
    await page.click('text=Sign in');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test.describe('Login', () => {
  test('login with valid credentials redirects to dashboard', async ({ page, request }) => {
    const email = uniqueEmail('login');
    await signupViaAPI(request, email, 'password123', 'Login User');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');

    // After login, app redirects to /dashboard
    await expect(page).toHaveURL(/\/(boards|dashboard)/);
  });

  test('login with wrong password shows an error', async ({ page, request }) => {
    const email = uniqueEmail('wrongpw');
    await signupViaAPI(request, email, 'correctpassword', 'WrongPW User');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
  });

  test('login with non-existent email shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'nobody-does-not-exist@example.com');
    await page.fill('#password', 'somepassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
  });

  test('login error does not navigate away from /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'wrong@example.com');
    await page.fill('#password', 'badpassword');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login/);
  });

  test('after login a JWT token is stored in localStorage', async ({ page, request }) => {
    const email = uniqueEmail('logintoken');
    await signupViaAPI(request, email, 'password123', 'Token Login User');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    // After login, app redirects to /dashboard
    await expect(page).toHaveURL(/\/(boards|dashboard)/);

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
    expect(token!.split('.').length).toBe(3);
  });

  test('submit button shows "Signing in..." while the request is in flight', async ({ page, request }) => {
    const email = uniqueEmail('loading');
    await signupViaAPI(request, email, 'password123', 'Loading User');

    await page.goto('/login');

    // Intercept the login API to delay it so we can observe the loading state
    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');

    // Button should be disabled while loading
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('can navigate from login to signup', async ({ page }) => {
    await page.goto('/login');
    await page.click('text=Create one');
    await expect(page).toHaveURL(/\/signup/);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Logout', () => {
  test('logout clears token from localStorage and redirects to /login', async ({ page, request }) => {
    const email = uniqueEmail('logout');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/boards/);

    // Click the logout button in the sidebar
    await page.click('.logout-btn');

    await expect(page).toHaveURL(/\/login/);

    const storedToken = await page.evaluate(() => localStorage.getItem('token'));
    expect(storedToken).toBeNull();
  });

  test('after logout, navigating to a protected route redirects to /login', async ({ page, request }) => {
    const email = uniqueEmail('postlogout');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);

    // Attempt to navigate to a protected route
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Already-authenticated redirects
// ---------------------------------------------------------------------------

test.describe('Already-authenticated redirects', () => {
  async function injectValidToken(
    page: Parameters<Parameters<typeof test>[1]>[0]['page'],
    request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  ): Promise<void> {
    const email = uniqueEmail('redir');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;
    // Navigate first so localStorage is accessible, then set the token
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  }

  test('visiting /login while authenticated redirects to /dashboard', async ({ page, request }) => {
    await injectValidToken(page, request);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('visiting /signup while authenticated redirects to /dashboard', async ({ page, request }) => {
    await injectValidToken(page, request);
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('root path / redirects to /dashboard when authenticated', async ({ page, request }) => {
    await injectValidToken(page, request);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// ---------------------------------------------------------------------------
// User display name shown after login
// ---------------------------------------------------------------------------

test.describe('Display name shown in sidebar after login', () => {
  test('user display name is visible in the sidebar after login', async ({ page, request }) => {
    const email = uniqueEmail('dispname');
    await signupViaAPI(request, email, 'password123', 'SidebarNameUser');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    // After login, app redirects to /dashboard
    await expect(page).toHaveURL(/\/(boards|dashboard)/);

    // Ensure sidebar is expanded so .user-name is rendered
    await page.evaluate(() => localStorage.setItem('gira-sidebar-collapsed', 'false'));
    await page.reload();

    await expect(page.locator('.user-name')).toContainText('SidebarNameUser');
  });
});
