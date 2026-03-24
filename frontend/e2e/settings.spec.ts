import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  displayName: string,
  prefix: string,
  password = 'password123',
) {
  const email = `${prefix}-${crypto.randomUUID()}@example.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, display_name: displayName },
  });
  expect(res.ok(), `signup failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; email: string; display_name: string; is_admin: boolean }, email, password };
}

async function promoteAdmin(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
) {
  const res = await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `promoteAdmin failed: ${res.status()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// 1. Navigation to /settings
// ---------------------------------------------------------------------------

test.describe('Settings — Navigation', () => {
  test('direct navigation to /settings renders the settings page', async ({ page, request }) => {
    const { token } = await createUser(request, 'NavSettingsUser', 'settings-nav');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });

  test('clicking Settings link in sidebar navigates to /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'SidebarSettingsUser', 'settings-sidebar');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await page.click('a:has-text("Settings")');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('unauthenticated user is redirected to /login from /settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// 2. Profile section (visible to all users)
// ---------------------------------------------------------------------------

test.describe('Settings — Profile Section', () => {
  test('profile section is visible with heading "Profile"', async ({ page, request }) => {
    const { token } = await createUser(request, 'ProfileVisibleUser', 'settings-profile');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
  });

  test('profile section shows the logged-in user display name', async ({ page, request }) => {
    const { token } = await createUser(request, 'DisplayNameCheck', 'settings-dn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info h3')).toContainText('DisplayNameCheck');
  });

  test('profile section shows the logged-in user email', async ({ page, request }) => {
    const { token, email } = await createUser(request, 'EmailCheckUser', 'settings-email');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info p')).toContainText(email);
  });

  test('avatar placeholder renders the first initial of the display name', async ({ page, request }) => {
    const { token } = await createUser(request, 'InitialCheckUser', 'settings-initial');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.avatar-placeholder')).toBeVisible();
    await expect(page.locator('.avatar-placeholder')).toContainText('I');
  });
});

// ---------------------------------------------------------------------------
// 3. Global Gitea Connection section (admin-only)
// ---------------------------------------------------------------------------

test.describe('Settings — Global Gitea Connection (Admin Only)', () => {
  test('admin user sees the Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request, 'AdminGiteaUser', 'settings-admin-gitea');
    await promoteAdmin(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('admin user sees the Gitea URL input field', async ({ page, request }) => {
    const { token } = await createUser(request, 'AdminGiteaUrl', 'settings-admin-url');
    await promoteAdmin(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 8000 });
  });

  test('admin user sees the API Key input field', async ({ page, request }) => {
    const { token } = await createUser(request, 'AdminApiKeyUser', 'settings-admin-key');
    await promoteAdmin(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('#giteaApiKey')).toBeVisible({ timeout: 8000 });
  });

  test('non-admin user does NOT see the Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request, 'NonAdminUser', 'settings-nonadmin');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });

  test('admin: Save Configuration button is present', async ({ page, request }) => {
    const { token } = await createUser(request, 'AdminSaveBtn', 'settings-admin-save');
    await promoteAdmin(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(
      page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('POST /api/config is forbidden for non-admin users', async ({ request }) => {
    const { token } = await createUser(request, 'NonAdminConfig', 'settings-nonAdmin-config');

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'https://example.com', gitea_api_key: 'fake' },
    });

    expect(res.status()).toBe(403);
  });

  test('POST /api/config returns non-403/401 for admin', async ({ request }) => {
    const { token } = await createUser(request, 'AdminConfigPost', 'settings-admin-config-post');
    await promoteAdmin(request, token);

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'http://127.0.0.1:3000', gitea_api_key: 'fake-key-for-test' },
    });

    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
  });

  test('POST /api/config returns 400 when gitea_url is empty', async ({ request }) => {
    const { token } = await createUser(request, 'AdminConfigEmpty', 'settings-admin-config-empty');
    await promoteAdmin(request, token);

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: '', gitea_api_key: 'fake' },
    });

    expect(res.status()).toBe(400);
  });

  test('GET /api/config/status returns configured field', async ({ request }) => {
    const { token } = await createUser(request, 'ConfigStatusUser', 'settings-config-status');

    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// 4. Your API Credentials section (visible to all users)
// ---------------------------------------------------------------------------

test.describe('Settings — API Credentials Section', () => {
  test('credentials section heading is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'CredHeadingUser', 'settings-cred-heading');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
  });

  test('Add Credential button is visible in credentials section', async ({ page, request }) => {
    const { token } = await createUser(request, 'CredAddBtnUser', 'settings-cred-add-btn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('button:has-text("Add Credential")')).toBeVisible();
  });

  test('credentials section shows empty state when no credentials exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'CredEmptyUser', 'settings-cred-empty');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });
});

// ---------------------------------------------------------------------------
// 5. About section
// ---------------------------------------------------------------------------

test.describe('Settings — About Section', () => {
  test('About Zira section is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'AboutUser', 'settings-about');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("About Zira")')).toBeVisible();
  });

  test('About section shows version 1.0.0', async ({ page, request }) => {
    const { token } = await createUser(request, 'AboutVersionUser', 'settings-about-version');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.about-info')).toContainText('Version: 1.0.0');
  });
});

// ---------------------------------------------------------------------------
// 6. GET /api/config/status (API-level tests)
// ---------------------------------------------------------------------------

test.describe('Settings — Config Status API', () => {
  test('GET /api/config/status returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/config/status returns 200 with configured boolean when authenticated', async ({ request }) => {
    const { token } = await createUser(request, 'ConfigStatusAuth', 'settings-status-auth');

    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
    // gitea_url may be present
    expect('configured' in body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Settings page persists state across reload
// ---------------------------------------------------------------------------

test.describe('Settings — State Persistence', () => {
  test('user remains on settings page after reload (auth preserved)', async ({ page, request }) => {
    const { token } = await createUser(request, 'PersistSettingsUser', 'settings-persist');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);

    await page.reload();

    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });

  test('display name still shown in settings after reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'PersistNameUser', 'settings-persist-name');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await page.reload();

    await expect(page.locator('.profile-info h3')).toContainText('PersistNameUser');
  });
});
