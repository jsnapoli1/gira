import { test, expect } from '@playwright/test';

test.describe('Boards', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-boards-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Board Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/boards');
  });

  test('should show empty state when no boards', async ({ page }) => {
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  test('should create a new board', async ({ page }) => {
    // Click create board button
    await page.click('text=Create Board');

    // Fill in board details
    await page.fill('#boardName', 'Test Project');
    await page.fill('#boardDesc', 'A test project board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);
    await expect(page.locator('.board-header h1')).toContainText('Test Project');
  });

  test('should navigate to board view', async ({ page }) => {
    // Create a board first
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Navigate Test');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Should be on board page with either header or empty swimlanes
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Navigate Test');
  });

  test('should show board view with default columns', async ({ page }) => {
    // Create and navigate to board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Column Test');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Should have empty swimlanes message
    await expect(page.locator('.empty-swimlanes')).toBeVisible();
  });

  test('should delete a board', async ({ page }) => {
    // Create a board first
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Delete Me');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Go back to board list to delete
    await page.goto('/boards');

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    // Delete the board
    await page.click('.board-card-delete');

    // Board should be gone
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('should toggle between board and backlog view', async ({ page }) => {
    // Create and navigate to board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'View Toggle Test');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Should be on board view by default
    await expect(page.locator('.view-btn.active')).toContainText('Board');

    // Switch to backlog
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();

    // Switch back to board
    await page.click('.view-btn:has-text("Board")');
    await expect(page.locator('.board-content')).toBeVisible();
  });
});
