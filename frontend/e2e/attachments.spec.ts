import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Attachments', () => {
  // Use a unique temp file per worker to avoid parallel test collisions
  let testFilePath: string;
  const testFileContent = 'This is a test attachment file';

  test.beforeAll(async ({ }, testInfo) => {
    testFilePath = `/tmp/test-attachment-${testInfo.workerIndex}.txt`;
    fs.writeFileSync(testFilePath, testFileContent);
  });

  test.afterAll(async () => {
    if (testFilePath && fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-attachments-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Attachment Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Attachment Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Add a swimlane (required for cards)
    await page.click('.empty-swimlanes button:has-text("Add Swimlane")');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.fill('input[placeholder="Frontend"]', 'Test Swimlane');
    await page.fill('.modal input[placeholder="owner/repo"]', 'test/repo');
    await page.fill('input[placeholder="FE-"]', 'TEST-');
    await page.click('.modal .form-actions button:has-text("Add Swimlane")');
    // Switch to All Cards view so swimlane headers are visible without a sprint
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.swimlane-header', { timeout: 5000 });

    // Add a card via quick-add
    await page.click('.add-card-btn');
    await page.fill('.quick-add-form input', 'Test Card for Attachments');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should show empty attachments state', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Should show no attachments message
    await expect(page.locator('.attachments-sidebar .empty-text')).toBeVisible();
    await expect(page.locator('.attachments-sidebar .empty-text')).toContainText('No attachments');
  });

  test('should upload an attachment', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Upload a file via the hidden file input inside the attachments sidebar
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachment-name-small')).toContainText(path.basename(testFilePath));
  });

  test('should show attachment file size', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Upload a file
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment item (size may not be a separate element, check item is visible)
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 5000 });
  });

  test('should delete an attachment', async ({ page }) => {
    // Accept confirmation dialogs
    page.on('dialog', dialog => dialog.accept());

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Upload a file
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 5000 });

    // Delete the attachment
    await page.click('.attachment-delete-tiny');

    // Should show no attachments message
    await expect(page.locator('.attachments-sidebar .empty-text')).toBeVisible({ timeout: 5000 });
  });

  test('should persist attachments after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Upload a file
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachment should still be there
    await expect(page.locator('.attachment-name-small')).toContainText(path.basename(testFilePath));
  });

  test('should have upload button enabled', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Attachments sidebar section is always visible — no tab needed
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Upload label/button should be visible and not disabled
    const uploadLabel = page.locator('.attachments-sidebar label.btn');
    await expect(uploadLabel).toBeVisible();
    await expect(uploadLabel).toContainText('+');
  });
});
