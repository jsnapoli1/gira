import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Attachments', () => {
  // Create a temp test file
  const testFilePath = '/tmp/test-attachment.txt';
  const testFileContent = 'This is a test attachment file';

  test.beforeAll(async () => {
    fs.writeFileSync(testFilePath, testFileContent);
  });

  test.afterAll(async () => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-attachments-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Attachment Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Attachment Test Board');
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
    await page.fill('.quick-add-form input', 'Test Card for Attachments');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should show empty attachments state', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Should show no attachments message
    await expect(page.locator('.no-attachments')).toBeVisible();
    await expect(page.locator('.no-attachments')).toContainText('No attachments yet');
  });

  test('should upload an attachment', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Upload a file
    const fileInput = page.locator('.attachment-upload input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachment-filename')).toContainText('test-attachment.txt');
  });

  test('should show attachment file size', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Upload a file
    const fileInput = page.locator('.attachment-upload input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the file size
    await expect(page.locator('.attachment-size')).toBeVisible({ timeout: 5000 });
  });

  test('should delete an attachment', async ({ page }) => {
    // Accept confirmation dialogs
    page.on('dialog', dialog => dialog.accept());

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Upload a file
    const fileInput = page.locator('.attachment-upload input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item')).toBeVisible({ timeout: 5000 });

    // Delete the attachment
    await page.click('.attachment-delete');

    // Should show no attachments message
    await expect(page.locator('.no-attachments')).toBeVisible({ timeout: 5000 });
  });

  test('should persist attachments after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Upload a file
    const fileInput = page.locator('.attachment-upload input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show the attachment
    await expect(page.locator('.attachment-item')).toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Attachment should still be there
    await expect(page.locator('.attachment-filename')).toContainText('test-attachment.txt');
  });

  test('should have upload button enabled', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Attachments tab
    await page.click('.tab-btn:has-text("Attachments")');

    // Upload button should be visible
    await expect(page.locator('.upload-btn')).toBeVisible();
    await expect(page.locator('.upload-btn')).toContainText('Upload File');
  });
});
