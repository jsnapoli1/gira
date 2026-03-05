import { test, expect } from '@playwright/test';

test.describe('Issue Hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-hierarchy-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Hierarchy Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Hierarchy Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.waitForSelector('.board-card-link', { timeout: 5000 });
    await page.click('.board-card-link');

    // Add a swimlane (required for cards)
    await page.click('.empty-swimlanes button:has-text("Add Swimlane")');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.fill('input[placeholder="Frontend"]', 'Test Swimlane');
    await page.fill('.modal input[placeholder="owner/repo"]', 'test/repo');
    await page.fill('input[placeholder="FE-"]', 'HIER-');
    await page.click('.modal .form-actions button:has-text("Add Swimlane")');
    await page.waitForSelector('.swimlane-header', { timeout: 5000 });

    // Add a card via quick-add
    await page.click('.add-card-btn');
    await page.fill('.quick-add-form input', 'Test Card for Hierarchy');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should show issue type badge on cards', async ({ page }) => {
    // Cards should have a type badge
    await expect(page.locator('.card-type-badge')).toBeVisible();
    // Default type should be task
    await expect(page.locator('.card-type-badge.type-task')).toBeVisible();
  });

  test('should show issue type in card detail', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Should show issue type in card detail meta
    await expect(page.locator('.card-issue-type')).toBeVisible();
    await expect(page.locator('.card-issue-type')).toContainText('task');
  });

  test('should be able to change issue type to epic', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to epic using the first select in the modal
    await page.locator('.card-detail-modal select').first().selectOption({ label: 'Epic' });

    // Save
    await page.click('.card-detail-modal button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show epic type in the meta section
    await expect(page.locator('.card-detail-modal .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should be able to change issue type to story', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to story using the first select in the modal
    await page.locator('.card-detail-modal select').first().selectOption({ label: 'Story' });

    // Save
    await page.click('.card-detail-modal button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show story type in the meta section
    await expect(page.locator('.card-detail-modal .card-issue-type')).toContainText('story', { timeout: 5000 });
  });

  test('should be able to change issue type to subtask', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to subtask using the first select in the modal
    await page.locator('.card-detail-modal select').first().selectOption({ label: 'Subtask' });

    // Save
    await page.click('.card-detail-modal button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show subtask type in the meta section
    await expect(page.locator('.card-detail-modal .card-issue-type')).toContainText('subtask', { timeout: 5000 });
  });

  test('should persist issue type after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to epic using the first select in the modal
    await page.locator('.card-detail-modal select').first().selectOption({ label: 'Epic' });

    // Save
    await page.click('.card-detail-modal button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal')).not.toBeVisible();

    // Verify the card badge shows epic
    await expect(page.locator('.card-type-badge.type-epic')).toBeVisible({ timeout: 5000 });

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal', { timeout: 5000 });

    // Issue type should still be epic
    await expect(page.locator('.card-detail-modal .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should show correct type badge character', async ({ page }) => {
    // Task badge should show "T"
    const badge = page.locator('.card-type-badge.type-task');
    await expect(badge).toContainText('T');
  });
});
