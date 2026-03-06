import { test, expect } from '@playwright/test';

test.describe('User Credentials', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-creds-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Credentials Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);
  });

  test('should navigate to settings and see credentials section', async ({ page }) => {
    await page.click('a:has-text("Settings")');
    await expect(page).toHaveURL(/\/settings/);

    // Should show credentials section
    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  test('should open add credential modal', async ({ page }) => {
    await page.goto('/settings');

    // Click add credential button
    await page.click('button:has-text("Add Credential")');

    // Modal should appear
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toContainText('Add API Credential');

    // Should have provider tabs
    await expect(page.locator('.provider-tab:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('.provider-tab:has-text("GitHub")')).toBeVisible();
  });

  test('should show Gitea URL field when Gitea is selected', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Gitea should be selected by default
    await expect(page.locator('.provider-tab.active:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('#providerUrl')).toBeVisible();
  });

  test('should hide URL field when GitHub is selected', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Click GitHub tab
    await page.click('.provider-tab:has-text("GitHub")');

    // URL field should not be visible
    await expect(page.locator('.provider-tab.active:has-text("GitHub")')).toBeVisible();
    await expect(page.locator('#providerUrl')).not.toBeVisible();
  });

  test('should close modal when clicking X', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Click close button
    await page.click('.modal-header .btn-icon');

    // Modal should be closed
    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  test('should close modal when clicking overlay', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Click overlay (outside modal)
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });

    // Modal should be closed
    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  test('should have disabled test button when form is incomplete', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Test button should be disabled initially
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // Fill only URL
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // Fill token too
    await page.fill('#apiToken', 'test-token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  test('should require URL for Gitea but not for GitHub', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Fill only token for Gitea - should be disabled
    await page.fill('#apiToken', 'test-token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // Switch to GitHub - should be enabled with just token
    await page.click('.provider-tab:has-text("GitHub")');
    await page.fill('#apiToken', 'ghp_test_token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  test.skip('should show connection error for invalid credentials', async ({ page }) => {
    // Skip: requires actual API call that will fail in different ways
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Fill form
    await page.fill('#providerUrl', 'https://gitea.invalid.example.com');
    await page.fill('#apiToken', 'invalid-token');

    // Test connection
    await page.click('button:has-text("Test Connection")');

    // Should show error
    await expect(page.locator('.status-badge.error')).toBeVisible();
  });

  test('admin should see global Gitea config section', async ({ page }) => {
    // Note: The first user is auto-promoted to admin
    await page.goto('/settings');

    // Admin should see global config section
    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible();
  });
});
