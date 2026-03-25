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
 * Inject a JWT token into localStorage using page.evaluate (not addInitScript),
 * as required by this project's test conventions.
 */
async function injectToken(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  token: string,
): Promise<void> {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test.describe('Settings page — structure', () => {
  test.beforeEach(async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-struct-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Structure Test User', email);
    await injectToken(page, token);
  });

  test('settings page renders the .settings-page container', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible();
  });

  test('settings page has a Settings h1 heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });

  test('settings page shows the Profile section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
  });

  test('settings page shows the Your API Credentials section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
  });

  test('settings page shows the About Gira section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("About Gira")')).toBeVisible();
  });

  test('About Gira section contains version 1.0.0', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.about-info')).toContainText('Version: 1.0.0');
  });

  test('unauthenticated user is redirected from /settings to /login', async ({ page }) => {
    // Clear any token
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('token'));
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Profile display in settings
// ---------------------------------------------------------------------------

test.describe('Settings page — profile display', () => {
  test('profile section shows the logged-in user display name', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-profile-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Settings Profile User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info h3')).toContainText('Settings Profile User');
  });

  test('profile section shows the logged-in user email', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-email-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Settings Email User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-info p')).toContainText(email);
  });

  test('profile card shows avatar placeholder for users without avatar_url', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-avatar-${ts}@example.com`;
    const { token } = await signupAPI(request, 'AvatarSettings User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.avatar-placeholder')).toBeVisible();
  });

  test('avatar placeholder shows the uppercased first character of the display name', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-initial-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Quentin Settings', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.avatar-placeholder')).toContainText('Q');
  });
});

// ---------------------------------------------------------------------------
// API Credentials — page structure & Add Credential button
// ---------------------------------------------------------------------------

test.describe('Settings page — API credentials section', () => {
  let userToken: string;

  test.beforeEach(async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-cred-${ts}@example.com`;
    const result = await signupAPI(request, 'Credential Test User', email);
    userToken = result.token;
    await injectToken(page, userToken);
  });

  test('Add Credential button is visible for non-admin users', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('button:has-text("Add Credential")')).toBeVisible();
  });

  test('empty state message shown when no credentials are configured', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  test('clicking Add Credential opens the credential modal', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();
  });

  test('credential modal can be closed without saving', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  test('add Gitea credential successfully and it appears in the list', async ({ page }) => {
    await page.goto('/settings');

    // Mock the test-connection endpoint so modal saves without hitting a real server
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected successfully' }),
      });
    });

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'fake-token-abc123');
    await page.fill('#displayName', 'My Test Gitea');
    await page.click('button[type="submit"]:has-text("Save")');

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
    await expect(page.locator('.credentials-list .credential-item')).toBeVisible();
    await expect(page.locator('.credential-name')).toContainText('My Test Gitea');
  });

  test('credential list shows provider label for a Gitea credential', async ({ page, request }) => {
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'fake-token-provider',
      },
    });

    await page.goto('/settings');

    await expect(page.locator('.credential-provider')).toContainText('Gitea');
  });

  test('delete credential removes it from the list', async ({ page, request }) => {
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: {
        provider: 'gitea',
        display_name: 'Cred To Delete',
        provider_url: 'https://gitea.example.com',
        api_token: 'fake-token-delete',
      },
    });

    await page.goto('/settings');
    await expect(page.locator('.credential-item')).toBeVisible();

    // Accept the browser confirm dialog and click delete
    page.once('dialog', (d) => d.accept());
    await page.click('.credential-item button[title="Delete credential"]');

    await expect(page.locator('.credential-item')).not.toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  test('test connection success shows a Connected badge in the modal', async ({ page }) => {
    await page.goto('/settings');

    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected successfully' }),
      });
    });

    await page.click('button:has-text("Add Credential")');
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'valid-token-xyz');
    await page.click('button:has-text("Test Connection")');

    await expect(page.locator('.status-badge.success')).toBeVisible();
    await expect(page.locator('.status-badge.success span')).toContainText('Connected');
  });

  test('multiple credentials are all listed on the settings page', async ({ page, request }) => {
    // Create two credentials via API
    for (const name of ['First Gitea', 'Second Gitea']) {
      await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${userToken}` },
        data: {
          provider: 'gitea',
          display_name: name,
          provider_url: 'https://gitea.example.com',
          api_token: 'fake-multi-token',
        },
      });
    }

    await page.goto('/settings');

    const items = page.locator('.credential-item');
    await expect(items).toHaveCount(2);
  });
});

// ---------------------------------------------------------------------------
// Admin-only features
// ---------------------------------------------------------------------------

test.describe('Settings page — admin-only features', () => {
  test('admin user sees the Global Gitea Connection section', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-admin-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Settings User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('admin sees Gitea URL and API Key fields inside the Global Gitea Connection section', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-admin-form-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Form User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
  });

  test('non-admin user does NOT see the Global Gitea Connection section', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-nonadmin-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Non-Admin Settings User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });

  test('admin can save a Gitea configuration and see a success badge', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-admin-save-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Save User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');

    await page.fill('#giteaUrl', 'https://gitea.example.com');
    await page.fill('#giteaApiKey', 'fake-admin-key');
    // The submit button text is either "Save Configuration" or "Update Configuration"
    // depending on whether a Gitea URL is already saved. Use a regex to match both.
    await page.locator('button[type="submit"]').filter({ hasText: /Configuration/ }).click();

    // Success banner should appear
    await expect(page.locator('.status-badge.success span:has-text("saved")')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// NOTE: Theme toggle, language preference, and account deletion
// ---------------------------------------------------------------------------
//
// These features do NOT exist in the current Settings.tsx implementation.
// They can be added here when implemented:
//
// test.fixme('theme toggle changes the app to dark mode', ...)
// test.fixme('language preference persists across reloads', ...)
// test.fixme('account deletion requires confirmation', ...)
//
// Account deletion in particular should be marked fixme as a dangerous
// destructive operation that must be guarded carefully.

// ---------------------------------------------------------------------------
// User profile — API contract (GET /api/auth/me)
// ---------------------------------------------------------------------------

test.describe('User profile — API', () => {

  test('GET /api/auth/me returns user with display_name and email', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-api-me-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Me Test User', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('display_name', 'Me Test User');
    expect(body).toHaveProperty('email', email);
  });

  test('GET /api/auth/me does not return password_hash', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-api-nohash-${ts}@example.com`;
    const { token } = await signupAPI(request, 'No Hash User', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.password_hash).toBeUndefined();
  });

  test('GET /api/auth/me returns is_admin field', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-api-admin-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Field User', email);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body).toHaveProperty('is_admin');
    expect(typeof body.is_admin).toBe('boolean');
  });

  test('GET /api/auth/me returns 401 without token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me returns 401 with invalid token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: 'Bearer this.is.notvalid' },
    });
    expect(res.status()).toBe(401);
  });

  test('signup returns user with correct display_name', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-signup-dn-${ts}@example.com`;
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Signup Display' },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.display_name).toBe('Signup Display');
  });

  test('signup returns user with correct email', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-signup-em-${ts}@example.com`;
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Email Check User' },
    });

    const body = await res.json();
    expect(body.user.email).toBe(email);
  });

  test('login returns same user as signup', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-login-same-${ts}@example.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'securePass!1', display_name: 'Login Same User' },
    });
    const signupBody = await signupRes.json();

    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'securePass!1' },
    });
    const loginBody = await loginRes.json();

    expect(loginBody.user.id).toBe(signupBody.user.id);
    expect(loginBody.user.display_name).toBe('Login Same User');
    expect(loginBody.user.email).toBe(email);
  });

});

// ---------------------------------------------------------------------------
// User profile — display in Settings page (additional)
// ---------------------------------------------------------------------------

test.describe('Settings page — profile display (additional)', () => {

  test('profile section shows current email as read-only text', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-email-ro-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Email RO User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    // Email is shown in the profile-info paragraph (read-only display)
    await expect(page.locator('.profile-info p')).toContainText(email);
    // It must NOT be an editable input in the current implementation
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toHaveCount(0);
  });

  test('avatar placeholder initial is uppercase', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-upper-${ts}@example.com`;
    const { token } = await signupAPI(request, 'zelda springs', email);

    await injectToken(page, token);
    await page.goto('/settings');

    // First character uppercased: 'Z'
    await expect(page.locator('.avatar-placeholder')).toContainText('Z');
  });

  test('profile section does not expose password field', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-nopw-${ts}@example.com`;
    const { token } = await signupAPI(request, 'No PW Visible', email);

    await injectToken(page, token);
    await page.goto('/settings');

    // There should be no password input in the profile card
    const pwInput = page.locator('.profile-card input[type="password"]');
    await expect(pwInput).toHaveCount(0);
  });

  test('settings page profile card is present', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-profile-card-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Profile Card User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.profile-card')).toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// User profile — update display name and password (future features, fixme)
// ---------------------------------------------------------------------------

test.describe('User profile — update (future features)', () => {

  test.fixme('PUT /api/users/me updates display_name and returns updated user', async ({ request }) => {
    // PUT /api/users/me does not currently exist.  This test documents the
    // expected contract once the endpoint is implemented.
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-upd-dn-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Before Update', email);

    const res = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: 'After Update' },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe('After Update');
  });

  test.fixme('update display name via settings page UI reflects change in sidebar', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-ui-dn-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Old Name UI', email);

    await injectToken(page, token);
    await page.goto('/settings');

    // Find display name input and update it
    const dnInput = page.locator('input[name="display_name"], input[placeholder*="display name" i]');
    await expect(dnInput).toBeVisible({ timeout: 8000 });
    await dnInput.fill('New Name UI');
    await page.locator('button:has-text("Save"), button[type="submit"]').first().click();

    // Sidebar or header should reflect the new name
    const sidebar = page.locator('.sidebar, .nav-user, .user-name');
    await expect(sidebar).toContainText('New Name UI', { timeout: 8000 });
  });

  test.fixme('update display name via settings page UI reflects in profile section', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-ui-dn2-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Before Name', email);

    await injectToken(page, token);
    await page.goto('/settings');

    const dnInput = page.locator('input[name="display_name"], input[placeholder*="display name" i]');
    await expect(dnInput).toBeVisible({ timeout: 8000 });
    await dnInput.fill('After Name');
    await page.locator('button:has-text("Save"), button[type="submit"]').first().click();

    await expect(page.locator('.profile-info h3')).toContainText('After Name', { timeout: 8000 });
  });

  test.fixme('display name with special characters is stored and displayed correctly', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-special-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Jane & Doe <Test>', email);

    // Verify GET /api/auth/me echoes back the special-character display name
    const res = await (await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    // The display name must survive round-trip through the API unchanged.
    expect(res.display_name).toBe('Jane & Doe <Test>');
  });

  test.fixme('change password via settings UI works and allows re-login', async ({ page, request }) => {
    // Password change UI does not currently exist.
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-pw-change-${ts}@example.com`;
    const { token } = await signupAPI(request, 'PW Change User', email, 'oldPassword1!');

    await injectToken(page, token);
    await page.goto('/settings');

    // Fill in change-password form
    await page.fill('input[name="current_password"]', 'oldPassword1!');
    await page.fill('input[name="new_password"]', 'newPassword2@');
    await page.fill('input[name="confirm_password"]', 'newPassword2@');
    await page.locator('button:has-text("Change Password")').click();
    await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 8000 });

    // Confirm new password works for login
    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'newPassword2@' },
    });
    expect(loginRes.status()).toBe(200);
  });

  test.fixme('API: password change with wrong current password returns 400', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-pw-wrong-${ts}@example.com`;
    const { token } = await signupAPI(request, 'PW Wrong User', email, 'correctPass1!');

    const res = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { current_password: 'wrongPass!', new_password: 'newPass2@' },
    });

    expect(res.status()).toBe(400);
  });

  test.fixme('display name update persists after logout and re-login', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-persist-dn-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Persist Before', email);

    // Update display name via API
    await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: 'Persist After' },
    });

    // Login again to get fresh token
    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'password123' },
    });
    const { token: freshToken } = await loginRes.json();

    // Load the settings page with the fresh token
    await injectToken(page, freshToken);
    await page.goto('/settings');
    await expect(page.locator('.profile-info h3')).toContainText('Persist After');
  });

  test.fixme('display name min/max length validation on settings form', async ({ page, request }) => {
    // A display name of 1+ characters must be accepted; an empty one rejected.
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-dn-len-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Length Test User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    const dnInput = page.locator('input[name="display_name"], input[placeholder*="display name" i]');
    await expect(dnInput).toBeVisible({ timeout: 8000 });

    // Clear input and submit with empty value — must show error
    await dnInput.fill('');
    await page.locator('button:has-text("Save"), button[type="submit"]').first().click();
    const errorMsg = page.locator('.error-message, .field-error, [role="alert"]');
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });

});

// ---------------------------------------------------------------------------
// Settings page — credential section details
// ---------------------------------------------------------------------------

test.describe('Settings page — credential section details', () => {

  test('Your API Credentials section has a .section-description paragraph', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-desc-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Cred Desc User', email);

    await injectToken(page, token);
    await page.goto('/settings');

    const credSection = page.locator('.settings-section').filter({
      has: page.locator('h2:has-text("Your API Credentials")'),
    });
    await expect(credSection.locator('.section-description')).toBeVisible({ timeout: 8000 });
  });

  test('credential item has a .credential-icon element', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-icon-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Cred Icon User', email);

    // Create a credential via API so the list is non-empty
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_icon_test',
        display_name: 'Icon Test Cred',
      },
    });

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.credential-item')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.credential-item .credential-icon')).toBeVisible();
  });

  test('credential item shows the display_name in .credential-name', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-name-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Cred Name User', email);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'tok-display',
        display_name: 'My Work Gitea',
      },
    });

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.credential-name:has-text("My Work Gitea")')).toBeVisible({ timeout: 8000 });
  });

  test('two credentials are both visible in the credentials list', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-two-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Two Creds User', email);

    for (const name of ['First Cred', 'Second Cred']) {
      await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          provider: 'github',
          api_token: `ghp_two_${name.replace(' ', '_')}`,
          display_name: name,
        },
      });
    }

    await injectToken(page, token);
    await page.goto('/settings');

    await expect(page.locator('.credentials-list .credential-item')).toHaveCount(2, { timeout: 8000 });
  });

  test('credential provider label shows "Gitea" in .credential-provider for gitea provider', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-prov-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Provider Label User', email);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'tok-prov',
        display_name: 'Prov Label Test',
      },
    });

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.credential-provider')).toContainText('Gitea', { timeout: 8000 });
  });

  test('credential persists after page reload', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cred-persist-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Persist Cred User', email);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_persist_check',
        display_name: 'Persist Check Cred',
      },
    });

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.credential-name:has-text("Persist Check Cred")')).toBeVisible({ timeout: 8000 });

    await page.reload();
    await expect(page.locator('.credential-name:has-text("Persist Check Cred")')).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Settings page — Add Credential modal details
// ---------------------------------------------------------------------------

test.describe('Settings page — Add Credential modal details', () => {

  test('credential modal Gitea tab is active by default', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-gitea-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal Gitea User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.provider-tab.active')).toContainText('Gitea');
  });

  test('credential modal has displayName optional field', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-dn-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal DN User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#displayName')).toBeVisible();
  });

  test('credential modal Save button disabled when no fields filled', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-disabled-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal Disabled User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('button[type="submit"]:has-text("Save")')).toBeDisabled();
  });

  test('switching to GitHub tab hides providerUrl field', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-gh-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal GitHub User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await page.click('.provider-tab:has-text("GitHub")');
    await expect(page.locator('#providerUrl')).not.toBeVisible();
  });

  test('credential modal providerUrl has type="url" on Gitea tab', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-url-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal URL Type User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#providerUrl')).toHaveAttribute('type', 'url');
  });

  test('credential modal closes when X button clicked', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-close-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal Close User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    // Click the X button in the modal header
    await page.locator('.modal-header button.btn-icon').click();
    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test('credential count increases by one after adding a credential via UI', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-modal-count-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Modal Count User', email);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });

    // Mock the test-connection endpoint to avoid real network calls
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected' }),
      });
    });

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'ghp_count_test_token');
    await page.fill('#displayName', 'Count Test Cred');
    await page.click('button[type="submit"]:has-text("Save")');

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.credentials-list .credential-item')).toHaveCount(1, { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Settings page — admin section details
// ---------------------------------------------------------------------------

test.describe('Settings page — admin section details', () => {

  test('Global Gitea Connection section has a .section-description paragraph (admin)', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-desc-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Desc User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible({ timeout: 10000 });

    const adminSection = page.locator('.settings-section').filter({
      has: page.locator('h2:has-text("Global Gitea Connection")'),
    });
    await expect(adminSection.locator('.section-description')).toBeVisible();
  });

  test('admin settings page renders at least 4 .settings-section elements', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-4sec-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin 4 Sections', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');
    await page.waitForSelector('.settings-content', { timeout: 10000 });

    const count = await page.locator('.settings-section').count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('admin Gitea URL field placeholder is "https://gitea.example.com"', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-ph-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Placeholder User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('#giteaUrl')).toHaveAttribute('placeholder', 'https://gitea.example.com');
  });

  test('admin can type a URL into the Gitea URL field', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-type-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Type User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 8000 });

    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.fill('#giteaUrl', 'https://my-gitea.example.com');
    await expect(page.locator('#giteaUrl')).toHaveValue('https://my-gitea.example.com');
  });

  test('after saving config the giteaApiKey field is cleared', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-clear-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin Clear Key User', email);
    await promoteAdmin(request, token);

    await injectToken(page, token);
    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 8000 });

    await page.fill('#giteaUrl', 'https://gitea.clear-test.example.com');
    await page.fill('#giteaApiKey', 'temp-secret-key');
    await expect(page.locator('#giteaApiKey')).toHaveValue('temp-secret-key');

    await page.locator('button[type="submit"]').filter({ hasText: /Configuration/ }).click();

    // Wait for success badge, then verify API key was cleared from UI
    await expect(page.locator('.status-badge.success').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#giteaApiKey')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Settings page — API: admin user management
// ---------------------------------------------------------------------------

test.describe('Settings page — API: admin user management', () => {

  test('GET /api/admin/users returns 401 without authentication', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/users`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/users returns 403 for non-admin users', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-list-403-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Non Admin List User', email);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/users returns array of users for admin', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-list-ok-${ts}@example.com`;
    const { token } = await signupAPI(request, 'Admin List OK', email);
    await promoteAdmin(request, token);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('user list contains the newly promoted admin', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-inlist-${ts}@example.com`;
    const { token, user } = await signupAPI(request, 'In List Admin', email);
    await promoteAdmin(request, token);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const users = await res.json();
    const entry = users.find((u: { id: number }) => u.id === user.id);
    expect(entry).toBeDefined();
    expect(entry.is_admin).toBe(true);
  });

  test('user list does not expose password_hash for any user', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-admin-nohash-${ts}@example.com`;
    const { token } = await signupAPI(request, 'No Hash Admin', email);
    await promoteAdmin(request, token);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const users = await res.json();
    for (const u of users) {
      expect(u.password_hash).toBeUndefined();
    }
  });

  test('admin can promote another user to admin via PUT /api/admin/users', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminEmail = `test-promote-admin-${ts}@example.com`;
    const userEmail = `test-promote-user-${ts}@example.com`;
    const { token: adminToken } = await signupAPI(request, 'Promote Admin', adminEmail);
    await promoteAdmin(request, adminToken);
    const { user: targetUser } = await signupAPI(request, 'Target User', userEmail);

    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: targetUser.id, is_admin: true },
    });
    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.is_admin).toBe(true);
  });

  test('POST /api/auth/promote-admin promotes the calling user', async ({ request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-self-promote-${ts}@example.com`;
    const { token, user } = await signupAPI(request, 'Self Promote', email);
    expect(user.is_admin).toBeFalsy();

    const promRes = await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 204]).toContain(promRes.status());

    // Verify the user is now admin via the users list
    const listRes = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const users = await listRes.json();
    const entry = users.find((u: { id: number }) => u.id === user.id);
    expect(entry?.is_admin).toBe(true);
  });

  test('POST /api/auth/promote-admin without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/promote-admin`);
    expect(res.status()).toBe(401);
  });
});
