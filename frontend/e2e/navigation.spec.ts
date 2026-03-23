import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-nav-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Nav Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/boards');
  });

  test('should show sidebar with navigation items', async ({ page }) => {
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.nav-item:has-text("Boards")')).toBeVisible();
    await expect(page.locator('.nav-item:has-text("Reports")')).toBeVisible();
    await expect(page.locator('.nav-item:has-text("Settings")')).toBeVisible();
  });

  test('should navigate between pages', async ({ page }) => {
    // Navigate to Reports
    await page.click('.nav-item:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.nav-item.active')).toContainText('Reports');

    // Navigate to Settings
    await page.click('.nav-item:has-text("Settings")');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.nav-item.active')).toContainText('Settings');

    // Navigate back to Boards
    await page.click('.nav-item:has-text("Boards")');
    await expect(page).toHaveURL(/\/boards/);
    await expect(page.locator('.nav-item.active')).toContainText('Boards');
  });

  test('should show user info in sidebar', async ({ page }) => {
    await expect(page.locator('.user-name')).toContainText('Nav Test User');
  });

  test('should logout user', async ({ page }) => {
    await page.click('.logout-btn');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to login when accessing protected route without auth', async ({ page }) => {
    // Clear auth
    await page.evaluate(() => localStorage.clear());

    // Try to access protected route
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});
