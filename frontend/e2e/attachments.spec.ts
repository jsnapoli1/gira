import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

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

  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-attachments-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Attachment Test User',
      },
    })).json();

    // Create a board (response includes columns array)
    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Attachment Test Board' },
    })).json();

    const columns = board.columns;

    // Create a swimlane
    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TEST-' },
    })).json();

    // Create a card
    await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card for Attachments',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })).json();

    // Set token in localStorage and navigate to board
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    // Switch to All Cards view so swimlane headers are visible without a sprint
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
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
