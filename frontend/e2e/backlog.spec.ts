import { test, expect } from '@playwright/test';

test.describe('Backlog', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user, login, and create a board
    const uniqueEmail = `test-backlog-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Backlog Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Backlog Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.waitForSelector('.board-card-link', { timeout: 5000 });
    await page.click('.board-card-link');
  });

  test('should show backlog header with create sprint button', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Backlog header should be visible with Create Sprint button
    await expect(page.locator('.backlog-header')).toBeVisible();
    await expect(page.locator('.backlog-header h2')).toContainText('Backlog');
    await expect(page.locator('.backlog-header button:has-text("Create Sprint")')).toBeVisible();
  });

  test('should create sprint from backlog header', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Click create sprint button in header
    await page.click('.backlog-header button:has-text("Create Sprint")');

    // Modal should appear
    await expect(page.locator('.modal h2')).toContainText('Create Sprint');

    // Fill in sprint details
    await page.fill('input[placeholder="Sprint 1"]', 'New Sprint');
    await page.click('button[type="submit"]:has-text("Create")');

    // Sprint should appear
    await expect(page.locator('.backlog-section-header h2:has-text("New Sprint")')).toBeVisible();
  });
});
