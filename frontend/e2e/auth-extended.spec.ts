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
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: displayName },
  });
  return res;
}

// ---------------------------------------------------------------------------
// Registration Validation
// ---------------------------------------------------------------------------

test.describe('Registration Validation', () => {
  test('signup with mismatched passwords shows client-side error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail('mismatch'));
    await page.fill('#password', 'pass123');
    await page.fill('#confirmPassword', 'different');
    await page.click('button[type="submit"]');

    // Client-side validation fires before any network request
    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.locator('.auth-error')).toContainText('Passwords do not match');
  });

  test('signup with short password shows client-side error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail('short'));
    // 5-char password — below the 6-char minimum
    await page.fill('#password', 'abc12');
    await page.fill('#confirmPassword', 'abc12');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.locator('.auth-error')).toContainText('at least 6 characters');
  });

  test('signup with duplicate email shows server error', async ({ page, request }) => {
    const email = uniqueEmail('dup');
    // Pre-create the user via API
    await signupViaAPI(request, email);

    // Try to sign up with the same email via the UI
    await page.goto('/signup');
    await page.fill('#displayName', 'Duplicate User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');

    // Server should return an error (email already exists)
    await expect(page.locator('.auth-error')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Login Edge Cases — already-authenticated redirects
// ---------------------------------------------------------------------------

test.describe('Already-authenticated redirects', () => {
  // Helper: inject a real token by signing up then capturing the token
  async function injectValidToken(
    page: Parameters<Parameters<typeof test>[1]>[0]['page'],
    request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  ) {
    const email = uniqueEmail('redir');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;

    await page.addInitScript((t) => {
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

  test('root path / redirects to /login when not authenticated', async ({ page }) => {
    // No token injected — just navigate to root
    await page.goto('/');
    // Root -> /dashboard -> /login (unauthenticated)
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Token Handling
// ---------------------------------------------------------------------------

test.describe('Token Handling', () => {
  test('corrupted token in localStorage redirects to /login', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'not.a.jwt.token');
    });
    // Navigate to a protected route — AuthContext will call /api/auth/me which returns 401
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout clears localStorage token and redirects to /login', async ({ page, request }) => {
    const email = uniqueEmail('logout');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;

    await page.addInitScript((t) => {
      localStorage.setItem('token', t);
    }, token);

    await page.goto('/dashboard');
    // Confirm we are authenticated
    await expect(page).toHaveURL(/\/dashboard/);

    // Click the logout button
    await page.click('.logout-btn');

    // Should be redirected to /login
    await expect(page).toHaveURL(/\/login/);

    // Token must be removed from localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('token'));
    expect(storedToken).toBeNull();
  });

  test('after logout, navigating to a protected route redirects to /login', async ({ page }) => {
    // Sign up via UI so the token lands in localStorage naturally (no addInitScript)
    const email = uniqueEmail('postlogout');
    await page.goto('/signup');
    await page.fill('#displayName', 'Post Logout User');
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);

    // Logout via the sidebar button
    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);

    // Navigating to a protected route while logged out must redirect back to /login
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Admin / Role Tests
// ---------------------------------------------------------------------------

test.describe('Admin / Role Tests', () => {
  test('non-admin user cannot see Global Gitea Connection section', async ({ page, request }) => {
    // Any newly registered user (not the very first one) is non-admin
    const email = uniqueEmail('nonadmin');
    const res = await signupViaAPI(request, email);
    const body = await res.json();
    const token: string = body.token;

    await page.addInitScript((t) => {
      localStorage.setItem('token', t);
    }, token);

    await page.goto('/settings');

    // The Settings page must have loaded (Profile section is always visible)
    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();

    // The admin-only section must NOT be visible for a non-admin user
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });
});
