import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupAPI(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  displayName: string,
  email: string,
  password = 'password123',
): Promise<{ token: string; user: { id: number; email: string; display_name: string; is_admin: boolean } }> {
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: displayName },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token, user: body.user };
}

async function loginAPI(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  email: string,
  password: string,
): Promise<{ token: string; user: { id: number; email: string; display_name: string; is_admin: boolean } }> {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token, user: body.user };
}

async function promoteAdmin(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
): Promise<void> {
  const res = await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * Inject a JWT token into localStorage after a page.goto so that AuthContext
 * picks it up on the next navigation. Uses page.evaluate (not addInitScript)
 * as required by this project's test conventions.
 */
async function injectToken(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  token: string,
): Promise<void> {
  // Navigate to a public page first so localStorage is accessible
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// Profile info lives on /settings — no dedicated /profile route exists
// ---------------------------------------------------------------------------

test.describe('Profile section on settings page', () => {
  test('settings page shows a Profile section heading', async ({ page, request }) => {
    const email = `profile-settings-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileSectionUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
  });

  test('settings page profile section shows the user display name in .profile-info h3', async ({ page, request }) => {
    const email = `profile-name-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileNameUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info h3')).toContainText('ProfileNameUser');
  });

  test('settings page profile section shows the user email in .profile-info p', async ({ page, request }) => {
    const email = `profile-email-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileEmailUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info p')).toContainText(email);
  });

  test('profile card element is visible on the settings page', async ({ page, request }) => {
    const email = `profile-card-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileCardUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-card')).toBeVisible();
  });

  test('profile data persists after a full page reload', async ({ page, request }) => {
    const email = `profile-reload-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ReloadPersistUser', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.profile-info h3')).toContainText('ReloadPersistUser');

    await page.reload();

    await expect(page.locator('.profile-info h3')).toContainText('ReloadPersistUser');
    await expect(page.locator('.profile-info p')).toContainText(email);
  });
});

// ---------------------------------------------------------------------------
// Avatar / initials
// ---------------------------------------------------------------------------

test.describe('Avatar / initials', () => {
  test('user avatar placeholder is visible in the sidebar footer', async ({ page, request }) => {
    const email = `profile-avatar-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'AvatarUser', email);

    await injectToken(page, token);
    await page.goto('/dashboard');

    // .user-avatar is always rendered in the sidebar regardless of collapse state
    await expect(page.locator('.user-avatar')).toBeVisible();
  });

  test('settings page shows avatar-placeholder for users without avatar_url', async ({ page, request }) => {
    const email = `profile-avatar2-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'InitialsUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    // When avatar_url is absent the profile card renders .avatar-placeholder
    await expect(page.locator('.avatar-placeholder')).toBeVisible();
  });

  test('avatar placeholder shows first character of display name uppercased', async ({ page, request }) => {
    const email = `profile-initial-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'wonderUser', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.avatar-placeholder')).toContainText('W');
  });

  test('avatar placeholder initial is uppercase for display name starting with lowercase', async ({ page, request }) => {
    const email = `profile-lower-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'zephyr', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.avatar-placeholder')).toContainText('Z');
  });
});

// ---------------------------------------------------------------------------
// Display name in sidebar
// ---------------------------------------------------------------------------

test.describe('Display name in sidebar navigation', () => {
  test('logged-in user display_name is visible in the sidebar footer when sidebar is expanded', async ({ page, request }) => {
    const email = `profile-nav-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'NavDisplayUser', email);

    await injectToken(page, token);
    // Ensure sidebar is not collapsed so .user-name is rendered
    await page.evaluate(() => localStorage.setItem('zira-sidebar-collapsed', 'false'));
    await page.goto('/dashboard');

    await expect(page.locator('.user-name')).toContainText('NavDisplayUser');
  });

  test('display name in sidebar matches the email used to sign up', async ({ page, request }) => {
    const email = `profile-match-${crypto.randomUUID()}@example.com`;
    const displayName = `MatchUser-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await signupAPI(request, displayName, email);

    await injectToken(page, token);
    await page.evaluate(() => localStorage.setItem('zira-sidebar-collapsed', 'false'));
    await page.goto('/dashboard');

    await expect(page.locator('.user-name')).toContainText(displayName);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me endpoint
// ---------------------------------------------------------------------------

test.describe('GET /api/auth/me', () => {
  test('returns id, email, display_name, and is_admin fields', async ({ request }) => {
    const email = `profile-me-${crypto.randomUUID()}@example.com`;
    const { token, user: created } = await signupAPI(request, 'MeUser', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const me = await res.json();

    expect(typeof me.id).toBe('number');
    expect(me.email).toBe(email);
    expect(me.display_name).toBe('MeUser');
    expect(typeof me.is_admin).toBe('boolean');
    expect(me.id).toBe(created.id);
  });

  test('returns 401 with no token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('returns 401 with a malformed token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: 'Bearer not.a.valid.token' },
    });
    expect(res.status()).toBe(401);
  });

  test('/api/auth/me returns is_admin=false for a freshly created user', async ({ request }) => {
    const email = `profile-nonadmin-flag-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'NonAdminFlagUser', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();
    expect(me.is_admin).toBe(false);
  });

  test('/api/auth/me returns is_admin=true after promotion', async ({ request }) => {
    const email = `profile-admin-flag-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'AdminFlagUser', email);
    await promoteAdmin(request, token);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();
    expect(me.is_admin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

test.describe('Session persistence', () => {
  test('page refresh keeps the user logged in (token survives reload)', async ({ page, request }) => {
    const email = `profile-persist-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'PersistUser', email);

    await injectToken(page, token);
    await page.evaluate(() => localStorage.setItem('zira-sidebar-collapsed', 'false'));
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Reload — AuthContext re-reads localStorage and re-validates the token
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);

    await expect(page.locator('.user-name')).toContainText('PersistUser');
  });

  test('token is still present in localStorage after navigating to a protected page', async ({ page, request }) => {
    const email = `profile-persist2-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'TokenPersistUser', email);

    await injectToken(page, token);
    await page.goto('/dashboard');

    const stored = await page.evaluate(() => localStorage.getItem('token'));
    expect(stored).not.toBeNull();
    expect(stored).toBe(token);
  });

  test('settings page is accessible after page reload', async ({ page, request }) => {
    const email = `profile-settings-reload-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'SettingsReloadUser', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.settings-page')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Logout behaviour', () => {
  test('logout removes token from localStorage and redirects to /login', async ({ page, request }) => {
    const email = `profile-logout-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'LogoutUser', email);

    await injectToken(page, token);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);

    const storedToken = await page.evaluate(() => localStorage.getItem('token'));
    expect(storedToken).toBeNull();
  });

  test('after logout, navigating to /boards redirects to /login', async ({ page, request }) => {
    const email = `profile-logout2-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'LogoutRedirectUser', email);

    await injectToken(page, token);
    await page.goto('/dashboard');
    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Separate user sessions
// ---------------------------------------------------------------------------

test.describe('Separate user sessions', () => {
  test('two users in separate browser contexts see their own display names', async ({ browser, request }) => {
    const emailA = `profile-ua-${crypto.randomUUID()}@example.com`;
    const emailB = `profile-ub-${crypto.randomUUID()}@example.com`;

    const { token: tokenA } = await signupAPI(request, 'UserAlpha', emailA);
    const { token: tokenB } = await signupAPI(request, 'UserBeta', emailB);

    // Context A
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto('http://localhost:3000/login');
    await pageA.evaluate((t: string) => localStorage.setItem('token', t), tokenA);
    await pageA.goto('http://localhost:3000/settings');
    await expect(pageA.locator('.profile-info h3')).toContainText('UserAlpha');
    await ctxA.close();

    // Context B
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('http://localhost:3000/login');
    await pageB.evaluate((t: string) => localStorage.setItem('token', t), tokenB);
    await pageB.goto('http://localhost:3000/settings');
    await expect(pageB.locator('.profile-info h3')).toContainText('UserBeta');
    await ctxB.close();
  });

  test('user A token does not expose user B data via /api/auth/me', async ({ request }) => {
    const emailA = `profile-sep-a-${crypto.randomUUID()}@example.com`;
    const emailB = `profile-sep-b-${crypto.randomUUID()}@example.com`;

    const { token: tokenA, user: userA } = await signupAPI(request, 'SepUserA', emailA);
    const { user: userB } = await signupAPI(request, 'SepUserB', emailB);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const me = await res.json();

    expect(me.id).toBe(userA.id);
    expect(me.id).not.toBe(userB.id);
    expect(me.email).toBe(emailA);
  });
});

// ---------------------------------------------------------------------------
// User ID stability
// ---------------------------------------------------------------------------

test.describe('User ID stability', () => {
  test('user ID is the same across two separate login calls', async ({ request }) => {
    const email = `profile-stable-${crypto.randomUUID()}@example.com`;
    const password = 'password123';

    const { user: signupUser } = await signupAPI(request, 'StableUser', email, password);
    const { user: loginUser } = await loginAPI(request, email, password);

    expect(signupUser.id).toBe(loginUser.id);
  });

  test('/api/auth/me returns same id as the signup response', async ({ request }) => {
    const email = `profile-stable2-${crypto.randomUUID()}@example.com`;
    const { token, user: signupUser } = await signupAPI(request, 'StableUser2', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();

    expect(me.id).toBe(signupUser.id);
  });

  test('user ID does not change on page reload', async ({ page, request }) => {
    const email = `profile-stable3-${crypto.randomUUID()}@example.com`;
    const { token, user } = await signupAPI(request, 'StableReloadUser', email);

    await injectToken(page, token);
    await page.goto('/dashboard');

    const meBeforeReload = await page.evaluate(async (base: string) => {
      const t = localStorage.getItem('token');
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      return res.json();
    }, BASE);

    await page.reload();

    const meAfterReload = await page.evaluate(async (base: string) => {
      const t = localStorage.getItem('token');
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      return res.json();
    }, BASE);

    expect(meBeforeReload.id).toBe(meAfterReload.id);
    expect(meBeforeReload.id).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// Admin badge / indicator
// ---------------------------------------------------------------------------

test.describe('Admin indicator on settings page', () => {
  test('admin user sees Global Gitea Connection section (admin-only area)', async ({ page, request }) => {
    const email = `profile-admin-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileAdminUser', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('non-admin user does NOT see Global Gitea Connection section', async ({ page, request }) => {
    const email = `profile-nonadmin-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileNonAdmin', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });
});
