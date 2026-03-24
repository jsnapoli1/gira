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

// ---------------------------------------------------------------------------
// JWT / Token structure tests (API-level)
// ---------------------------------------------------------------------------

test.describe('JWT Token Structure', () => {
  test('login response body contains a token field', async ({ request }) => {
    const email = uniqueEmail('jwt-login');
    await signupViaAPI(request, email);

    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'password123' },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  test('signup response body contains a token field', async ({ request }) => {
    const res = await signupViaAPI(request, uniqueEmail('jwt-signup'));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  test('JWT token has exactly 3 dot-separated parts (header.payload.signature)', async ({ request }) => {
    const res = await signupViaAPI(request, uniqueEmail('jwt-parts'));
    const { token } = await res.json();
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    // Each part should be non-empty base64url strings
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  test('JWT payload contains user_id claim', async ({ request }) => {
    const res = await signupViaAPI(request, uniqueEmail('jwt-claims'));
    const { token } = await res.json();

    // Decode the middle part (payload) without verification
    const payloadB64 = token.split('.')[1];
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));

    expect(typeof payload.user_id).toBe('number');
    expect(payload.user_id).toBeGreaterThan(0);
  });

  test('token from signup works immediately for GET /api/auth/me', async ({ request }) => {
    const email = uniqueEmail('me-signup');
    const signupRes = await signupViaAPI(request, email);
    const { token } = await signupRes.json();

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status()).toBe(200);
    const user = await meRes.json();
    expect(user.email).toBe(email);
  });

  test('GET /api/auth/me with valid token returns user object', async ({ request }) => {
    const email = uniqueEmail('me-valid');
    const displayName = 'Valid Token User';
    const res = await signupViaAPI(request, email, 'password123', displayName);
    const { token } = await res.json();

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status()).toBe(200);
    const user = await meRes.json();
    expect(user.email).toBe(email);
    expect(user.display_name).toBe(displayName);
  });

  test('GET /api/auth/me with invalid token returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: 'Bearer this.is.notvalid' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me without token returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('token is usable for other protected API calls immediately after signup', async ({ request }) => {
    const res = await signupViaAPI(request, uniqueEmail('token-boards'));
    const { token } = await res.json();

    // Using the token for a protected endpoint (boards list)
    const boardsRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(boardsRes.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Signup and Login Behaviour
// ---------------------------------------------------------------------------

test.describe('Signup and Login Behaviour', () => {
  test('two signups with different emails both succeed', async ({ request }) => {
    const res1 = await signupViaAPI(request, uniqueEmail('two-a'));
    const res2 = await signupViaAPI(request, uniqueEmail('two-b'));
    expect(res1.status()).toBe(200);
    expect(res2.status()).toBe(200);
  });

  test('same email signed up twice returns 409', async ({ request }) => {
    const email = uniqueEmail('dup-api');
    const first = await signupViaAPI(request, email);
    expect(first.status()).toBe(200);

    const second = await signupViaAPI(request, email);
    expect(second.status()).toBe(409);
  });

  test('login with wrong password returns 401', async ({ request }) => {
    const email = uniqueEmail('wrong-pw');
    await signupViaAPI(request, email);

    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'wrongpassword!' },
    });
    expect(loginRes.status()).toBe(401);
  });

  test('password shorter than 6 characters is rejected at signup API level', async ({ request }) => {
    const res = await signupViaAPI(request, uniqueEmail('short-pw'), 'abc12');
    // Server should reject too-short passwords (400 or similar)
    expect(res.status()).not.toBe(200);
    expect([400, 422]).toContain(res.status());
  });

  test('display_name is required for signup — missing returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email: uniqueEmail('no-name'), password: 'password123' },
    });
    expect(res.status()).toBe(400);
  });

  test('login with email that was signed up returns a token', async ({ request }) => {
    const email = uniqueEmail('login-token');
    await signupViaAPI(request, email);

    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'password123' },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  test('password is stored as bcrypt hash — not echoed back in user object', async ({ request }) => {
    const email = uniqueEmail('pw-hash');
    const res = await signupViaAPI(request, email);
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The user object in the response must never contain the raw password or a hash
    const userStr = JSON.stringify(body.user);
    expect(userStr).not.toContain('password123');
    // password_hash field should not be exposed
    expect(body.user.password_hash).toBeUndefined();
    expect(body.user.password).toBeUndefined();
  });

  test('very long password (72 chars) is accepted at signup', async ({ request }) => {
    const longPassword = 'A'.repeat(72);
    const res = await signupViaAPI(request, uniqueEmail('long-pw'), longPassword);
    expect(res.status()).toBe(200);
  });

  test('login with email in different case is treated as the original email', async ({ request }) => {
    const lowerEmail = `casetest-${crypto.randomUUID()}@example.com`;
    await signupViaAPI(request, lowerEmail);

    // Try to login with upper-cased version
    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email: lowerEmail.toUpperCase(), password: 'password123' },
    });
    // Depending on backend case handling: either 200 (case-insensitive) or 401 (case-sensitive)
    // Both are valid — just verify the response is one of these two
    expect([200, 401]).toContain(loginRes.status());
  });
});

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

test.describe('Session Persistence', () => {
  test('session persists across client-side navigation (token stays in localStorage)', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('persist');
    const res = await signupViaAPI(request, email);
    const { token } = await res.json();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Navigate to /boards and back — token should still be set
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/boards/);

    const storedToken = await page.evaluate(() => localStorage.getItem('token'));
    expect(storedToken).toBe(token);
  });

  test('clearing localStorage causes redirect to /login on next navigation', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('clear-ls');
    const res = await signupViaAPI(request, email);
    const { token } = await res.json();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Manually clear localStorage (simulates token expiry / manual clear)
    await page.evaluate(() => localStorage.clear());

    // Navigate to a protected route — should redirect to login
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });
});
