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

function injectToken(token: string) {
  return (t: string) => localStorage.setItem('token', t);
}

// ---------------------------------------------------------------------------
// 1. Display name shown in sidebar
// ---------------------------------------------------------------------------

test.describe('Display name in navigation', () => {
  test('logged-in user display_name is visible in the sidebar footer', async ({ page, request }) => {
    const email = `profile-nav-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'NavDisplayUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');

    // Layout sidebar renders .user-name with the display_name when sidebar is expanded
    await expect(page.locator('.user-name')).toContainText('NavDisplayUser');
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/auth/me returns correct fields
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
    // id must match the signup response
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
});

// ---------------------------------------------------------------------------
// 3. Profile section on settings page shows display name
// ---------------------------------------------------------------------------

test.describe('Profile section on settings page', () => {
  test('settings page profile section shows the user display name', async ({ page, request }) => {
    const email = `profile-settings-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileSectionUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/settings');

    // Settings page has a Profile section with the user display name in .profile-info h3
    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(page.locator('.profile-info h3')).toContainText('ProfileSectionUser');
  });

  test('settings page profile section shows the user email', async ({ page, request }) => {
    const email = `profile-email-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileEmailUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info p')).toContainText(email);
  });
});

// ---------------------------------------------------------------------------
// 4. Avatar / initials in sidebar
// ---------------------------------------------------------------------------

test.describe('Avatar / initials in sidebar', () => {
  test('user avatar placeholder is visible in the sidebar footer', async ({ page, request }) => {
    const email = `profile-avatar-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'AvatarUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');

    // .user-avatar is always rendered in sidebar regardless of collapse state
    await expect(page.locator('.user-avatar')).toBeVisible();
  });

  test('settings page profile section shows avatar placeholder for users without avatar_url', async ({ page, request }) => {
    const email = `profile-avatar2-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'InitialsUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/settings');

    // When avatar_url is absent, the profile card renders .avatar-placeholder with the initial
    await expect(page.locator('.avatar-placeholder')).toBeVisible();
    await expect(page.locator('.avatar-placeholder')).toContainText('I');
  });
});

// ---------------------------------------------------------------------------
// 5. Logout clears token and redirects to /login
// ---------------------------------------------------------------------------

test.describe('Logout behaviour', () => {
  test('logout removes token from localStorage', async ({ page, request }) => {
    const email = `profile-logout-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'LogoutUser', email);

    await page.addInitScript(injectToken(token), token);
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

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');
    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// 6. Session persists on page refresh
// ---------------------------------------------------------------------------

test.describe('Session persistence', () => {
  test('page refresh keeps the user logged in (token survives reload)', async ({ page, request }) => {
    const email = `profile-persist-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'PersistUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Reload — AuthContext re-reads localStorage and re-validates the token
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);

    // Sidebar user name still visible after reload
    await expect(page.locator('.user-name')).toContainText('PersistUser');
  });

  test('token is present in localStorage after login', async ({ page, request }) => {
    const email = `profile-persist2-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'TokenPersistUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');

    const stored = await page.evaluate(() => localStorage.getItem('token'));
    expect(stored).not.toBeNull();
    expect(stored).toBe(token);
  });
});

// ---------------------------------------------------------------------------
// 7. Two users have separate sessions
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
    await pageA.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
    await pageA.goto('/settings');
    await expect(pageA.locator('.profile-info h3')).toContainText('UserAlpha');
    await ctxA.close();

    // Context B
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await pageB.goto('/settings');
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
// 8. Display name visible on card assignee chip
// ---------------------------------------------------------------------------

test.describe('Display name on card assignee chip', () => {
  test('user display_name shown as tooltip on card assignee bubble after assignment', async ({ page, request }) => {
    const email = `profile-chip-${crypto.randomUUID()}@example.com`;
    const displayName = `ChipUser-${crypto.randomUUID().slice(0, 6)}`;
    const { token, user } = await signupAPI(request, displayName, email);

    // Create a board with swimlane + card via API
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Profile Chip Board ${crypto.randomUUID().slice(0, 8)}`, description: '' },
    });
    const board = await boardRes.json();

    const colRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colRes.json();

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Profile Lane', repo_owner: '', repo_name: '', designator: 'CHIP-', color: '#6366f1' },
    });
    const swimlane = await slRes.json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { board_id: board.id, swimlane_id: swimlane.id, column_id: columns[0].id, title: 'Profile Chip Card' },
    });
    const card = await cardRes.json();

    // Assign self via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await page.addInitScript(injectToken(token), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');

    // Card item on the board should show the assignee bubble with title = displayName
    const assigneeBubble = page.locator('.card-item .card-assignees .card-assignee').first();
    await expect(assigneeBubble).toBeVisible({ timeout: 8000 });
    await expect(assigneeBubble).toHaveAttribute('title', displayName);
  });
});

// ---------------------------------------------------------------------------
// 9. Admin badge — admin user indicator on settings page
// ---------------------------------------------------------------------------

test.describe('Admin indicator', () => {
  test('admin user sees Global Gitea Connection section (admin-only area)', async ({ page, request }) => {
    const email = `profile-admin-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileAdminUser', email);
    await promoteAdmin(request, token);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/settings');

    // Admin-only section is the visual indicator of admin status in settings
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('non-admin user does NOT see Global Gitea Connection section', async ({ page, request }) => {
    const email = `profile-nonadmin-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'ProfileNonAdmin', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });

  test('GET /api/auth/me returns is_admin=true after promotion', async ({ request }) => {
    const email = `profile-admin-flag-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'AdminFlagUser', email);
    await promoteAdmin(request, token);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();
    expect(me.is_admin).toBe(true);
  });

  test('GET /api/auth/me returns is_admin=false for regular user', async ({ request }) => {
    const email = `profile-nonadmin-flag-${crypto.randomUUID()}@example.com`;
    const { token } = await signupAPI(request, 'NonAdminFlagUser', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();
    expect(me.is_admin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. User ID is stable across sessions
// ---------------------------------------------------------------------------

test.describe('User ID stability', () => {
  test('user ID is the same across two separate login calls', async ({ request }) => {
    const email = `profile-stable-${crypto.randomUUID()}@example.com`;
    const password = 'password123';

    // Create user
    const { user: signupUser } = await signupAPI(request, 'StableUser', email, password);

    // Login a second time independently
    const { user: loginUser } = await loginAPI(request, email, password);

    expect(signupUser.id).toBe(loginUser.id);
  });

  test('/api/auth/me returns same id as the login response', async ({ request }) => {
    const email = `profile-stable2-${crypto.randomUUID()}@example.com`;
    const { token, user: loginUser } = await signupAPI(request, 'StableUser2', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();

    expect(me.id).toBe(loginUser.id);
  });

  test('user ID does not change on page reload', async ({ page, request }) => {
    const email = `profile-stable3-${crypto.randomUUID()}@example.com`;
    const { token, user } = await signupAPI(request, 'StableReloadUser', email);

    await page.addInitScript(injectToken(token), token);
    await page.goto('/dashboard');

    // Fetch /api/auth/me directly from the page context to confirm id
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
