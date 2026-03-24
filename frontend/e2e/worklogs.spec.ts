import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

test.describe('Work Logs (Time Tracking)', () => {
  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-worklogs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Worklog Test User',
      },
    })).json();

    // Create a board
    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Worklog Test Board' },
    })).json();

    // Get columns
    const { columns } = await (await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();

    // Create a swimlane
    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TEST-' },
    })).json();

    // Create a card
    await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card for Worklogs',
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

  test('should show compact time tracking section', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Should show the compact time tracking section with header
    await expect(page.locator('.time-tracking-compact')).toBeVisible();
    await expect(page.locator('.time-tracking-header')).toContainText('Time Tracking');
  });

  test('should show time logged initially as 0m', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Should show 0m logged initially
    await expect(page.locator('.time-tracking-stats .time-logged')).toBeVisible();
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged');
  });

  test('should log time via compact input', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Fill the compact time input and click Log
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');

    // Should update the logged time
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  });

  test('should update time logged total after adding entry', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log 90 minutes of work
    await page.fill('.time-input-mini', '90');
    await page.click('.time-tracking-actions button:has-text("Log")');

    // Should format and show the total
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
  });

  test('should clear input after logging time', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Fill and submit
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');

    // Wait for time to be logged
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });

    // Input should be cleared
    await expect(page.locator('.time-input-mini')).toHaveValue('');
  });

  test('should disable Log button when time is not entered', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log button should be disabled initially (no input value)
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();

    // Enter time
    await page.fill('.time-input-mini', '30');
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeEnabled();

    // Clear time
    await page.fill('.time-input-mini', '');
    await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  });

  test('should format hours and minutes correctly', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log 125 minutes (2h 5m)
    await page.fill('.time-input-mini', '125');
    await page.click('.time-tracking-actions button:has-text("Log")');

    // Should format correctly
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h 5m logged', { timeout: 5000 });
  });

  test('should accumulate logged time across multiple entries', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log first entry
    await page.fill('.time-input-mini', '30');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });

    // Log second entry
    await page.fill('.time-input-mini', '45');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 15m logged', { timeout: 5000 });
  });

  test('should persist time logged after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Log time
    await page.fill('.time-input-mini', '60');
    await page.click('.time-tracking-actions button:has-text("Log")');
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Time logged should still be there
    await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
  });

  test('should show time tracking section inline without tabs', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // There should be no tab buttons - the unified layout shows everything inline
    await expect(page.locator('.tab-btn')).toHaveCount(0);

    // Time tracking should be visible directly (no tab click needed)
    await expect(page.locator('.time-tracking-compact')).toBeVisible();
  });
});
