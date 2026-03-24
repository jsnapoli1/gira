import { test, expect } from '@playwright/test';

test.describe('Cards', () => {
  // Note: These tests require Gitea to be configured.
  // In a real CI environment, you would mock the Gitea API.
  // For now, we test the UI flows that don't require Gitea.

  test.beforeEach(async ({ page }) => {
    // Create a unique user, login, and create a board
    const uniqueEmail = `test-cards-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Card Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Card Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);
  });

  test('should show add swimlane prompt on empty board', async ({ page }) => {
    await expect(page.locator('.empty-swimlanes')).toBeVisible();
    await expect(page.locator('.empty-swimlanes p')).toContainText('Add a swimlane');
  });

  test('should show Add Swimlane link on empty board', async ({ page }) => {
    // The "Add Swimlane" element is now a link that navigates to board settings
    await expect(page.locator('.empty-swimlanes a:has-text("Add Swimlane"), .empty-swimlanes .btn:has-text("Add Swimlane")')).toBeVisible();
  });

  test('should navigate to board settings when Add Swimlane is clicked', async ({ page }) => {
    // Clicking "Add Swimlane" from empty state navigates to board settings
    await page.click('.empty-swimlanes .btn');
    await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });
  });

  test('should show Add Swimlane button on board settings page', async ({ page }) => {
    // Navigate to board settings via the empty-swimlanes link
    await page.click('.empty-swimlanes .btn');
    await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

    // Board settings should have an "Add Swimlane" button that opens a modal
    await page.click('button:has-text("Add Swimlane")');
    await expect(page.locator('.modal h2')).toContainText('Add Swimlane');
  });

  test('should show swimlane form fields in settings modal', async ({ page }) => {
    // Navigate to board settings
    await page.click('.empty-swimlanes .btn');
    await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

    // Open the Add Swimlane modal from settings
    await page.click('button:has-text("Add Swimlane")');

    // Check form fields exist
    await expect(page.locator('input[placeholder="Frontend"]')).toBeVisible();
    await expect(page.locator('.modal input[placeholder="owner/repo"]')).toBeVisible();
    await expect(page.locator('input[placeholder="FE-"]')).toBeVisible();
    await expect(page.locator('.color-picker')).toBeVisible();
  });

  test('should cancel add swimlane modal in settings', async ({ page }) => {
    // Navigate to board settings
    await page.click('.empty-swimlanes .btn');
    await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

    // Open the Add Swimlane modal
    await page.click('button:has-text("Add Swimlane")');
    await expect(page.locator('.modal')).toBeVisible();

    await page.click('button:has-text("Cancel")');
    await expect(page.locator('.modal')).not.toBeVisible();
  });
});
