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

async function loginViaAPI(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  email: string,
  password: string,
) {
  return request.post(`${BASE}/api/auth/login`, {
    data: { email, password },
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

  test('login page shows Welcome to Zira heading', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Welcome to Zira');
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
// Signup
// ---------------------------------------------------------------------------

test.describe('Signup', () => {
  test('signup with valid credentials succeeds and redirects to /boards', async ({ page }) => {
    const email = uniqueEmail('signup');

    await page.goto('/signup');
    await expect(page.locator('h1')).toContainText('Create Account');

    await page.fill('#displayName', 'New User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/boards/);
  });

  test('after signup a JWT token is stored in localStorage', async ({ page }) => {
    const email = uniqueEmail('jwt');

    await page.goto('/signup');
    await page.fill('#displayName', 'JWT User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
    expect(token).toBeTruthy();
    // JWT has three dot-separated parts
    expect(token!.split('.').length).toBe(3);
  });

  test('duplicate email signup shows an error', async ({ page, request }) => {
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
  test('login with valid credentials redirects to /boards', async ({ page, request }) => {
    const email = uniqueEmail('login');
    await signupViaAPI(request, email, 'password123', 'Login User');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/boards/);
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
    await page.fill('#email', 'nobody@example.com');
    await page.fill('#password', 'somepassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
  });

  test('after login a JWT token is stored in localStorage', async ({ page, request }) => {
    const email = uniqueEmail('logintoken');
    await signupViaAPI(request, email, 'password123', 'Token Login User');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
    expect(token!.split('.').length).toBe(3);
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

    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

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

    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

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
  ) {
    const email = uniqueEmail('redir');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);
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
