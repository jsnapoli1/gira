import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

test.describe('Issue Hierarchy', () => {
  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-hierarchy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Hierarchy Test User',
      },
    })).json();

    // Create a board (response includes columns array)
    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Hierarchy Test Board' },
    })).json();

    const columns = board.columns;

    // Create a swimlane
    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'HIER-' },
    })).json();

    // Create a card
    await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card for Hierarchy',
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

  test('should show issue type badge on cards', async ({ page }) => {
    // Cards should have a type badge
    await expect(page.locator('.card-type-badge')).toBeVisible();
    // Default type should be task
    await expect(page.locator('.card-type-badge.type-task')).toBeVisible();
  });

  test('should show issue type in card detail', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Should show issue type in card detail meta
    await expect(page.locator('.card-issue-type')).toBeVisible();
    await expect(page.locator('.card-issue-type')).toContainText('task');
  });

  test('should be able to change issue type to epic', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to epic using the first select in the modal
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });

    // Save
    await page.click('.card-detail-modal-unified button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show epic type in the meta section
    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should be able to change issue type to story', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to story using the first select in the modal
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Story' });

    // Save
    await page.click('.card-detail-modal-unified button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show story type in the meta section
    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('story', { timeout: 5000 });
  });

  test('should be able to change issue type to subtask', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to subtask using the first select in the modal
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Subtask' });

    // Save
    await page.click('.card-detail-modal-unified button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Should show subtask type in the meta section
    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('subtask', { timeout: 5000 });
  });

  test('should persist issue type after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change issue type to epic using the first select in the modal
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });

    // Save
    await page.click('.card-detail-modal-unified button:has-text("Save")');

    // Wait for save to complete and edit mode to exit
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Verify the card badge shows epic
    await expect(page.locator('.card-type-badge.type-epic')).toBeVisible({ timeout: 5000 });

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Issue type should still be epic
    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should show correct type badge character', async ({ page }) => {
    // Task badge should show "T"
    const badge = page.locator('.card-type-badge.type-task');
    await expect(badge).toContainText('T');
  });
});
