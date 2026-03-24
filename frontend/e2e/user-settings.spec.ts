import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// Helper: sign up a new user and return their JWT token
async function signupUser(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  displayName: string,
  email: string,
  password: string
): Promise<string> {
  await page.goto('/signup');
  await page.fill('#displayName', displayName);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  return token!;
}

test.describe('User Settings — Credential CRUD', () => {
  let userEmail: string;
  let userToken: string;

  test.beforeEach(async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    userEmail = `test-us-${ts}@example.com`;
    userToken = await signupUser(page, request, 'Settings CRUD User', userEmail, 'password123');
  });

  test('add Gitea credential successfully and it appears in the list', async ({ page }) => {
    await page.goto('/settings');

    // Mock the test-connection endpoint (not strictly needed for save, but modal calls it)
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected successfully' }),
      });
    });

    // Open modal
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    // Fill Gitea fields (Gitea tab is active by default)
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'fake-token-abc123');
    await page.fill('#displayName', 'My Test Gitea');

    // Save
    await page.click('button[type="submit"]:has-text("Save")');

    // Modal should close and credential appears in list
    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
    await expect(page.locator('.credentials-list .credential-item')).toBeVisible();
    await expect(page.locator('.credential-name')).toContainText('My Test Gitea');
  });

  test('delete credential removes it from the list', async ({ page, request }) => {
    // Create credential directly via API
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

    // Credential should be visible in the list
    await expect(page.locator('.credential-item')).toBeVisible();

    // Accept the confirm dialog and click delete
    page.once('dialog', (d) => d.accept());
    await page.click('.credential-item button[title="Delete credential"]');

    // Credential removed — empty state shown
    await expect(page.locator('.credential-item')).not.toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  test('credential list shows provider name for Gitea credential', async ({ page, request }) => {
    // Create a Gitea credential via API
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'fake-token-provider',
      },
    });

    await page.goto('/settings');

    // Credential provider text should mention Gitea
    await expect(page.locator('.credential-provider')).toContainText('Gitea');
  });

  test('test connection success shows success badge in modal', async ({ page }) => {
    await page.goto('/settings');

    // Mock the test endpoint before opening modal
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected successfully' }),
      });
    });

    // Open modal and fill fields
    await page.click('button:has-text("Add Credential")');
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'valid-token-xyz');

    // Click Test Connection
    await page.click('button:has-text("Test Connection")');

    // Success badge should appear
    await expect(page.locator('.status-badge.success')).toBeVisible();
    await expect(page.locator('.status-badge.success span')).toContainText('Connected');
  });
});

test.describe('User Settings — Page Structure', () => {
  test.beforeEach(async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-struct-${ts}@example.com`;
    await signupUser(page, request, 'Structure Test User', email, 'password123');
  });

  test('profile section shows the logged-in user display name', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(page.locator('.profile-info h3')).toContainText('Structure Test User');
  });

  test('about section is visible with version info', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("About Zira")')).toBeVisible();
    await expect(page.locator('.about-info')).toContainText('Version:');
    await expect(page.locator('.about-info')).toContainText('1.0.0');
  });

  test('credentials section is visible for non-admin users', async ({ page }) => {
    await page.goto('/settings');

    // Non-admin should still see the personal API keys section
    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
    // The add button should also be present
    await expect(page.locator('button:has-text("Add Credential")')).toBeVisible();
  });
});

test.describe('User Settings — Admin-Only Features', () => {
  test('admin sees Global Gitea Connection section', async ({ page, request }) => {
    const fs = await import('fs');
    const path = await import('path');
    const authFile = path.join(process.cwd(), 'test-results', '.admin-auth.json');
    const { email, password } = JSON.parse(fs.readFileSync(authFile, 'utf-8'));

    // Navigate to a page first so localStorage is accessible, then clear token
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('token'));
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")')
    ).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does NOT see Global Gitea Connection section', async ({ page, request }) => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-us-nonadmin-${ts}@example.com`;
    await signupUser(page, request, 'Non-Admin User', email, 'password123');

    await page.goto('/settings');

    // Non-admin should NOT see the Global Gitea section
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")')
    ).not.toBeVisible();
  });
});
