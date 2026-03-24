import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

test.describe('Custom Fields', () => {
  let boardId: string;

  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-custom-fields-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Custom Fields Test User',
      },
    })).json();

    // Create a board (response includes columns array)
    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Custom Fields Test Board' },
    })).json();

    boardId = String(board.id);
    const columns = board.columns;

    // Create a swimlane
    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'CF-' },
    })).json();

    // Create a card
    await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card for Custom Fields',
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

  test('should not show Custom Fields section when no custom fields exist', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The inline custom fields section should not be visible when no fields are defined
    await expect(page.locator('.custom-fields-compact')).not.toBeVisible();
  });

  test('should create a text custom field via API and display it', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Create a text custom field via API
    const response = await request.post(`/api/boards/${boardId}/custom-fields`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Project Code',
        field_type: 'text',
        options: '',
        required: false,
      },
    });
    expect(response.ok()).toBeTruthy();

    // Reload the page to fetch the new custom field
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The inline custom fields section should now be visible
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Should see the custom field label and an input for it
    await expect(page.locator('.custom-field-inline label')).toContainText('Project Code');
    await expect(page.locator('.custom-field-inline input[type="text"]')).toBeVisible();
  });

  test('should save custom field value', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Create a text custom field via API
    await request.post(`/api/boards/${boardId}/custom-fields`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Client Name',
        field_type: 'text',
        options: '',
        required: false,
      },
    });

    // Reload the page to fetch the new custom field
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for the custom fields section to appear
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Enter a value and blur to trigger save
    const input = page.locator('.custom-field-inline input[type="text"]');
    await input.fill('Acme Corporation');
    await input.blur();
    // Wait for save to complete
    await page.waitForTimeout(2000);

    // Close and reopen to verify persistence
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for loading to complete and field to appear with correct value
    // Use poll to wait for the value to be loaded
    await expect(async () => {
      const fieldInput = page.locator('.custom-field-inline input[type="text"]');
      await expect(fieldInput).toBeVisible();
      await expect(fieldInput).toHaveValue('Acme Corporation');
    }).toPass({ timeout: 15000 });
  });

  test('should support select field type', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Create a select custom field via API
    await request.post(`/api/boards/${boardId}/custom-fields`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Priority Level',
        field_type: 'select',
        options: JSON.stringify(['Low', 'Medium', 'High', 'Critical']),
        required: false,
      },
    });

    // Reload the page to fetch the new custom field
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for the custom fields section to appear
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Should see a select field inside .custom-field-inline
    const selectField = page.locator('.custom-field-inline select');
    await expect(selectField).toBeVisible();

    // Select an option
    await selectField.selectOption('High');

    // Close and reopen to verify persistence
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for custom fields to load
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Value should be persisted
    await expect(page.locator('.custom-field-inline select')).toHaveValue('High');
  });

  test('should support checkbox field type', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Create a checkbox custom field via API
    await request.post(`/api/boards/${boardId}/custom-fields`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Approved',
        field_type: 'checkbox',
        options: '',
        required: false,
      },
    });

    // Reload the page to fetch the new custom field
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for the custom fields section to appear
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Should see a checkbox inside .custom-field-inline
    const checkbox = page.locator('.custom-field-inline input[type="checkbox"]');
    await expect(checkbox).toBeVisible();

    // Initially unchecked
    await expect(checkbox).not.toBeChecked();

    // Check it
    await checkbox.check();

    // Close and reopen to verify persistence
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Wait for custom fields to load
    await expect(page.locator('.custom-fields-compact')).toBeVisible();

    // Value should be persisted
    await expect(page.locator('.custom-field-inline input[type="checkbox"]')).toBeChecked();
  });
});
