import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-settings-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Settings Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.click('a:has-text("Settings")');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });

  test('should display user profile', async ({ page }) => {
    await page.goto('/settings');

    // Should show profile section
    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(page.locator('.profile-info h3')).toContainText('Settings Test User');
  });

  test('should display Gitea configuration section', async ({ page }) => {
    await page.goto('/settings');

    // Should show Gitea section
    await expect(page.locator('.settings-section h2:has-text("Gitea Connection")')).toBeVisible();
    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
  });

  test.skip('should save Gitea configuration', async ({ page }) => {
    // Skip this test as it configures Gitea which affects other tests
    await page.goto('/settings');

    // Fill in Gitea config
    await page.fill('#giteaUrl', 'https://gitea.example.com');
    await page.fill('#giteaApiKey', 'test-api-key');
    // Click Save or Update button depending on current state
    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    // Should show success status badge
    await expect(page.locator('.status-badge.success, .status-badge:has-text("Connected")')).toBeVisible();
  });

  test('should display about section', async ({ page }) => {
    await page.goto('/settings');

    // Should show about section
    await expect(page.locator('.settings-section h2:has-text("About Zira")')).toBeVisible();
    await expect(page.locator('.about-info')).toContainText('Version: 1.0.0');
  });
});
