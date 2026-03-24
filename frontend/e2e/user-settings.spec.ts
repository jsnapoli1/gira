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

  test('settings page shows the About Zira section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("About Zira")')).toBeVisible();
  });

  test('About Zira section contains version 1.0.0', async ({ page }) => {
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
