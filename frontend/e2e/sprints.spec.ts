import { test, expect } from '@playwright/test';

test.describe('Sprints', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user, login, and create a board
    const uniqueEmail = `test-sprints-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Sprint Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/);

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Sprint Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.click('.board-card-link');
  });

  test('should create a sprint from backlog view', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Click create sprint button in backlog header
    await page.click('.backlog-header button:has-text("Create Sprint")');

    // Fill in sprint details
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint 1');
    await page.fill('textarea[placeholder="What do you want to achieve?"]', 'Complete initial features');
    await page.click('button[type="submit"]:has-text("Create")');

    // Sprint should appear
    await expect(page.locator('.backlog-section-header h2:has-text("Sprint 1")')).toBeVisible();
  });

  test('should start a sprint', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Create a sprint
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint to Start');
    await page.click('button[type="submit"]:has-text("Create")');

    // Start the sprint
    await page.click('button:has-text("Start Sprint")');

    // Should show as active
    await expect(page.locator('.active-sprint-badge')).toBeVisible();
  });

  test('should complete a sprint', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Create and start a sprint
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint to Complete');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.click('button:has-text("Start Sprint")');

    // Complete the sprint
    await page.click('button:has-text("Complete Sprint")');

    // Active sprint badge should be gone
    await expect(page.locator('.active-sprint-badge')).not.toBeVisible();
  });
});
