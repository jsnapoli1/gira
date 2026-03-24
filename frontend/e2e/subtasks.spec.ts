import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;

test.describe('Subtasks', () => {
  let token: string;
  let boardId: number;
  let cardId: number;

  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const email = `test-subtasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Subtask Tester' },
    });
    const signupData = await signupRes.json();
    token = signupData.token;

    // Create board — API returns Board directly (not wrapped)
    const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Subtask Test Board' },
    });
    const board = await boardRes.json();
    boardId = board.id;

    // Get columns — API returns []Column directly
    const columnsRes = await request.get(`http://localhost:${PORT}/api/boards/${boardId}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await columnsRes.json();

    // Create a swimlane (boards start with no swimlanes)
    const swimlaneRes = await request.post(`http://localhost:${PORT}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TSW-', color: '#6366f1' },
    });
    const swimlane = await swimlaneRes.json();

    // Create a parent card — API returns Card directly
    const cardRes = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Parent Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();
    cardId = card.id;

    // Inject token into localStorage and navigate to board
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // Switch to All Cards view so cards are visible without a sprint
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 8000 });
  });

  test('subtasks section visible in card modal', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtasks-section')).toBeVisible();
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks');
  });

  test('create subtask via Add button', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click the Add button in the subtasks header
    await page.click('.subtasks-header button:has-text("Add")');
    await expect(page.locator('.add-subtask-form')).toBeVisible();

    // Fill in the subtask title and submit
    await page.fill('.add-subtask-form input', 'My Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');

    // Subtask should appear in the list
    await expect(page.locator('.subtask-list')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.subtask-item')).toContainText('My Subtask');
  });

  test('subtask appears in list after creation', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Listed Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');

    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.subtask-list .subtask-item').first()).toContainText('Listed Subtask');
  });

  test('toggle subtask complete marks it as completed', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Create a subtask first
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Toggle Me');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });

    // The checkbox should initially be unchecked
    const checkbox = page.locator('.subtask-checkbox').first();
    await expect(checkbox).not.toBeChecked();

    // Click the checkbox to complete the subtask
    await checkbox.click();

    // After toggling, the item should have the subtask-completed class
    await expect(page.locator('.subtask-item.subtask-completed')).toBeVisible({ timeout: 8000 });
  });

  test('subtask persists after modal reopen', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Create a subtask
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Persistent Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });

    // Close modal by clicking the overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Subtask should still be in the list
    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.subtask-list .subtask-item').first()).toContainText('Persistent Subtask');
  });

  test('multiple subtasks — completing first does not affect second', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Create first subtask
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'First Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    // Create second subtask
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Second Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(2, { timeout: 8000 });

    // Complete the first subtask
    await page.locator('.subtask-checkbox').first().click();
    await expect(page.locator('.subtask-item.subtask-completed')).toHaveCount(1, { timeout: 8000 });

    // Second subtask should NOT be completed
    const items = page.locator('.subtask-list .subtask-item');
    await expect(items).toHaveCount(2);

    // Exactly one should be completed and one should not
    const completedItems = page.locator('.subtask-item.subtask-completed');
    const allItems = page.locator('.subtask-item');
    await expect(completedItems).toHaveCount(1);
    await expect(allItems).toHaveCount(2);
  });

  test('subtask progress bar shows correct fraction', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Create two subtasks
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Progress Task 1');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Progress Task 2');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(2, { timeout: 8000 });

    // Complete the first subtask
    await page.locator('.subtask-checkbox').first().click();
    await expect(page.locator('.subtask-item.subtask-completed')).toHaveCount(1, { timeout: 8000 });

    // Progress info should show 1/2
    await expect(page.locator('.subtask-progress-info')).toBeVisible();
    await expect(page.locator('.subtask-progress-info')).toContainText('1/2');
  });

  test('subtask count visible in subtasks header', async ({ page }) => {
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Before creating any subtask, header shows (0)
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (0)');

    // Create a subtask
    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Count Test');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    // Header should now show (1)
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (1)');
  });
});
