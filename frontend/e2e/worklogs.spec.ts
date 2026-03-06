import { test, expect } from '@playwright/test';

test.describe('Work Logs (Time Tracking)', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-worklogs-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Worklog Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Worklog Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.waitForSelector('.board-card-link', { timeout: 5000 });
    await page.click('.board-card-link');

    // Add a swimlane (required for cards)
    await page.click('.empty-swimlanes button:has-text("Add Swimlane")');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.fill('input[placeholder="Frontend"]', 'Test Swimlane');
    await page.fill('.modal input[placeholder="owner/repo"]', 'test/repo');
    await page.fill('input[placeholder="FE-"]', 'TEST-');
    await page.click('.modal .form-actions button:has-text("Add Swimlane")');
    await page.waitForSelector('.swimlane-header', { timeout: 5000 });

    // Add a card via quick-add
    await page.click('.add-card-btn');
    await page.fill('.quick-add-form input', 'Test Card for Worklogs');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should show empty work logs state', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Should show no work logs message
    await expect(page.locator('.no-worklogs')).toBeVisible();
    await expect(page.locator('.no-worklogs')).toContainText('No time logged yet');
  });

  test('should show time tracking summary', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Should show summary section
    await expect(page.locator('.time-tracking-summary')).toBeVisible();
    await expect(page.locator('.time-stat-label:has-text("Logged")')).toBeVisible();
  });

  test('should add a work log entry', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Fill the work log form
    await page.fill('.worklog-form input[type="number"]', '30');
    await page.fill('.worklog-form input[type="text"]', 'Worked on implementation');
    await page.click('.worklog-form button[type="submit"]');

    // Should show the work log entry
    await expect(page.locator('.worklog-item')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.worklog-time')).toContainText('30m');
    await expect(page.locator('.worklog-notes')).toContainText('Worked on implementation');
  });

  test('should show user name on work log entry', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add a work log
    await page.fill('.worklog-form input[type="number"]', '60');
    await page.click('.worklog-form button[type="submit"]');

    // Should show user name
    await expect(page.locator('.worklog-user-name')).toContainText('Worklog Test User');
  });

  test('should update time logged total after adding entry', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add 90 minutes of work
    await page.fill('.worklog-form input[type="number"]', '90');
    await page.click('.worklog-form button[type="submit"]');

    // Should update the total
    await expect(page.locator('.worklog-item')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.time-stat-value').first()).toContainText('1h 30m');
  });

  test('should add multiple work log entries', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add first entry
    await page.fill('.worklog-form input[type="number"]', '30');
    await page.fill('.worklog-form input[type="text"]', 'First work session');
    await page.click('.worklog-form button[type="submit"]');
    await expect(page.locator('.worklog-item')).toHaveCount(1, { timeout: 5000 });

    // Add second entry
    await page.fill('.worklog-form input[type="number"]', '45');
    await page.fill('.worklog-form input[type="text"]', 'Second work session');
    await page.click('.worklog-form button[type="submit"]');
    await expect(page.locator('.worklog-item')).toHaveCount(2, { timeout: 5000 });
  });

  test('should delete a work log entry', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add a work log
    await page.fill('.worklog-form input[type="number"]', '30');
    await page.click('.worklog-form button[type="submit"]');
    await expect(page.locator('.worklog-item')).toBeVisible({ timeout: 5000 });

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    // Delete the work log
    await page.hover('.worklog-item');
    await page.click('.worklog-delete');

    // Should show no work logs message
    await expect(page.locator('.no-worklogs')).toBeVisible({ timeout: 5000 });
  });

  test('should persist work logs after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add a work log
    await page.fill('.worklog-form input[type="number"]', '60');
    await page.fill('.worklog-form input[type="text"]', 'Persistent work log');
    await page.click('.worklog-form button[type="submit"]');
    await expect(page.locator('.worklog-item')).toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Work log should still be there
    await expect(page.locator('.worklog-notes')).toContainText('Persistent work log');
  });

  test('should clear form after adding work log', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Fill and submit
    await page.fill('.worklog-form input[type="number"]', '30');
    await page.fill('.worklog-form input[type="text"]', 'Test notes');
    await page.click('.worklog-form button[type="submit"]');

    // Wait for entry to appear
    await expect(page.locator('.worklog-item')).toBeVisible({ timeout: 5000 });

    // Form should be cleared
    await expect(page.locator('.worklog-form input[type="number"]')).toHaveValue('');
    await expect(page.locator('.worklog-form input[type="text"]')).toHaveValue('');
  });

  test('should disable submit button when time is not entered', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Submit button should be disabled initially
    await expect(page.locator('.worklog-form button[type="submit"]')).toBeDisabled();

    // Enter time
    await page.fill('.worklog-form input[type="number"]', '30');
    await expect(page.locator('.worklog-form button[type="submit"]')).toBeEnabled();

    // Clear time
    await page.fill('.worklog-form input[type="number"]', '');
    await expect(page.locator('.worklog-form button[type="submit"]')).toBeDisabled();
  });

  test('should format hours and minutes correctly', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Click on Time Tracking tab
    await page.click('.tab-btn:has-text("Time Tracking")');

    // Add 125 minutes (2h 5m)
    await page.fill('.worklog-form input[type="number"]', '125');
    await page.click('.worklog-form button[type="submit"]');

    // Should format correctly
    await expect(page.locator('.worklog-time')).toContainText('2h 5m');
  });
});
