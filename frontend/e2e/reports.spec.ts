import { test, expect } from '@playwright/test';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-reports-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Report Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);
  });

  test('should navigate to reports page', async ({ page }) => {
    await page.click('a:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.page-header h1')).toContainText('Reports');
  });

  test('should show empty state without board selected', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  test('should show metrics summary when board has sprints', async ({ page }) => {
    // First create a board with a sprint
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Report Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.click('.board-card-link');

    // Create a sprint
    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint 1');
    await page.click('button[type="submit"]:has-text("Create")');

    // Go to reports
    await page.click('a:has-text("Reports")');

    // Select the board
    await page.selectOption('.reports-filters select', { label: 'Report Board' });

    // Should show metrics summary
    await expect(page.locator('.metrics-summary')).toBeVisible();
  });

  test('should show chart sections', async ({ page }) => {
    // Create a board with a sprint
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Chart Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.click('.board-card-link');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint 1');
    await page.click('button[type="submit"]:has-text("Create")');

    // Go to reports
    await page.click('a:has-text("Reports")');
    await page.selectOption('.reports-filters select', { label: 'Chart Board' });

    // Should show chart cards
    await expect(page.locator('.chart-card h3:has-text("Sprint Burndown")')).toBeVisible();
    await expect(page.locator('.chart-card h3:has-text("Velocity Trend")')).toBeVisible();
    await expect(page.locator('.chart-card h3:has-text("Cumulative Flow")')).toBeVisible();
  });
});
