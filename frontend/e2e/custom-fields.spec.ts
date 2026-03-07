import { test, expect } from '@playwright/test';

test.describe('Custom Fields', () => {
  let boardId: string;

  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-custom-fields-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Custom Fields Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Custom Fields Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await page.waitForSelector('.board-card-link', { timeout: 5000 });

    // Get the board URL/id
    const href = await page.locator('.board-card-link').getAttribute('href');
    boardId = href?.split('/').pop() || '';

    await page.click('.board-card-link');

    // Add a swimlane (required for cards)
    await page.click('.empty-swimlanes button:has-text("Add Swimlane")');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.fill('input[placeholder="Frontend"]', 'Test Swimlane');
    await page.fill('.modal input[placeholder="owner/repo"]', 'test/repo');
    await page.fill('input[placeholder="FE-"]', 'CF-');
    await page.click('.modal .form-actions button:has-text("Add Swimlane")');
    await page.waitForSelector('.swimlane-header', { timeout: 5000 });

    // Add a card via quick-add
    await page.click('.add-card-btn');
    await page.fill('.quick-add-form input', 'Test Card for Custom Fields');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should not show Custom Fields tab when no custom fields exist', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Custom Fields tab should not be visible
    await expect(page.locator('.tab-btn:has-text("Custom Fields")')).not.toBeVisible();
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
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Custom Fields tab should now be visible
    await expect(page.locator('.tab-btn:has-text("Custom Fields")')).toBeVisible();

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Should see the custom field
    await expect(page.locator('.custom-field-label')).toContainText('Project Code');
    await expect(page.locator('.custom-field-input')).toBeVisible();
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
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Enter a value and blur to trigger save
    const input = page.locator('.custom-field-input');
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

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Wait for loading to complete and field to appear with correct value
    // Use poll to wait for the value to be loaded
    await expect(async () => {
      const fieldInput = page.locator('.custom-field-input');
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
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Should see a select field
    await expect(page.locator('.custom-field-select')).toBeVisible();

    // Select an option
    await page.selectOption('.custom-field-select', 'High');

    // Close and reopen to verify persistence
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Value should be persisted
    await expect(page.locator('.custom-field-select')).toHaveValue('High');
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
    await page.waitForSelector('.card-item', { timeout: 5000 });

    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Should see a checkbox
    const checkbox = page.locator('.custom-field-checkbox input[type="checkbox"]');
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

    // Click on Custom Fields tab
    await page.click('.tab-btn:has-text("Custom Fields")');

    // Value should be persisted
    await expect(page.locator('.custom-field-checkbox input[type="checkbox"]')).toBeChecked();
  });
});
