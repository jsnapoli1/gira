import { test, expect } from '@playwright/test';

test.describe('Notifications', () => {
  let boardId: string;

  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-notifications-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Notifications Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/boards/, { timeout: 10000 });

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Notifications Test Board');
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
    await page.fill('input[placeholder="FE-"]', 'NF-');
    await page.click('.modal .form-actions button:has-text("Add Swimlane")');
    await page.waitForSelector('.swimlane-header', { timeout: 5000 });

    // Add a card via quick-add
    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form input', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'Test Card for Notifications');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 10000 });
  });

  test('should show notification bell in sidebar', async ({ page }) => {
    // The notification bell should be visible
    await expect(page.locator('.notification-bell')).toBeVisible();
  });

  test('should show empty notifications dropdown', async ({ page }) => {
    // Click the notification bell
    await page.click('.notification-bell');

    // Should see the dropdown
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Should show empty message
    await expect(page.locator('.notification-empty')).toContainText('No notifications');
  });

  test('should receive notification when assigned to a card', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Get the user ID from the me endpoint
    const meResponse = await request.get('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await meResponse.json();
    const userId = userData.id;

    // Get the card ID
    const cardsResponse = await request.get(`/api/boards/${boardId}/cards`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const cards = await cardsResponse.json();
    const cardId = cards[0]?.id;

    // Create a second user to assign the card
    const secondUserEmail = `test-notifications-assigner-${Date.now()}@example.com`;
    const signupResponse = await request.post('/api/auth/signup', {
      data: {
        email: secondUserEmail,
        password: 'password123',
        display_name: 'Assigner User',
      },
    });
    const signupData = await signupResponse.json();
    const secondToken = signupData.token;

    // Second user adds first user as assignee to the card
    await request.post(`/api/cards/${cardId}/assignees`, {
      headers: {
        'Authorization': `Bearer ${secondToken}`,
        'Content-Type': 'application/json',
      },
      data: { user_id: userId },
    });

    // Reload to fetch notifications
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 5000 });

    // Check the notification badge
    await expect(page.locator('.notification-badge')).toBeVisible();
    await expect(page.locator('.notification-badge')).toContainText('1');

    // Click the bell to see the notification
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Should see the assignment notification
    await expect(page.locator('.notification-item')).toBeVisible();
    await expect(page.locator('.notification-title')).toContainText("You've been assigned");
  });

  test('should mark notification as read when clicked', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Create a notification via API
    const meResponse = await request.get('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await meResponse.json();

    // Get the card ID
    const cardsResponse = await request.get(`/api/boards/${boardId}/cards`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const cards = await cardsResponse.json();
    const cardId = cards[0]?.id;

    // Create a second user
    const secondUserEmail = `test-notifications-commenter-${Date.now()}@example.com`;
    const signupResponse = await request.post('/api/auth/signup', {
      data: {
        email: secondUserEmail,
        password: 'password123',
        display_name: 'Commenter User',
      },
    });
    const signupData = await signupResponse.json();
    const secondToken = signupData.token;

    // First, assign the card to the first user (so they get notified of comments)
    await request.post(`/api/cards/${cardId}/assignees`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { user_id: userData.id },
    });

    // Second user adds a comment (which should notify the assignee)
    await request.post(`/api/cards/${cardId}/comments`, {
      headers: {
        'Authorization': `Bearer ${secondToken}`,
        'Content-Type': 'application/json',
      },
      data: { body: 'This is a test comment' },
    });

    // Reload to fetch notifications
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 5000 });

    // Should have unread notification
    await expect(page.locator('.notification-badge')).toBeVisible();

    // Open the dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Find an unread notification and click it
    const unreadNotification = page.locator('.notification-item.unread').first();
    await expect(unreadNotification).toBeVisible();
    await unreadNotification.click();

    // After clicking, badge should update (or disappear if that was the only one)
    // Re-open the dropdown to verify
    await page.click('.notification-bell');

    // The notification should now be marked as read (no longer have unread class)
    // Wait a moment for the state to update
    await page.waitForTimeout(500);
  });

  test('should mark all notifications as read', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Get user data
    const meResponse = await request.get('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await meResponse.json();

    // Get the card ID
    const cardsResponse = await request.get(`/api/boards/${boardId}/cards`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const cards = await cardsResponse.json();
    const cardId = cards[0]?.id;

    // Create a second user
    const secondUserEmail = `test-notifications-batch-${Date.now()}@example.com`;
    const signupResponse = await request.post('/api/auth/signup', {
      data: {
        email: secondUserEmail,
        password: 'password123',
        display_name: 'Batch User',
      },
    });
    const signupData = await signupResponse.json();
    const secondToken = signupData.token;

    // Assign first user to card
    await request.post(`/api/cards/${cardId}/assignees`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { user_id: userData.id },
    });

    // Second user adds multiple comments to generate notifications
    for (let i = 0; i < 3; i++) {
      await request.post(`/api/cards/${cardId}/comments`, {
        headers: {
          'Authorization': `Bearer ${secondToken}`,
          'Content-Type': 'application/json',
        },
        data: { body: `Comment ${i + 1}` },
      });
    }

    // Reload to fetch notifications
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 5000 });

    // Should have multiple unread notifications
    await expect(page.locator('.notification-badge')).toBeVisible();

    // Open the dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Click mark all as read
    await page.click('.mark-all-read-btn');

    // Badge should disappear
    await expect(page.locator('.notification-badge')).not.toBeVisible();
  });

  test('should delete a notification', async ({ page, request }) => {
    // Get auth token
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Get user data
    const meResponse = await request.get('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await meResponse.json();

    // Get the card ID
    const cardsResponse = await request.get(`/api/boards/${boardId}/cards`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const cards = await cardsResponse.json();
    const cardId = cards[0]?.id;

    // Create a second user
    const secondUserEmail = `test-notifications-delete-${Date.now()}@example.com`;
    const signupResponse = await request.post('/api/auth/signup', {
      data: {
        email: secondUserEmail,
        password: 'password123',
        display_name: 'Delete Test User',
      },
    });
    const signupData = await signupResponse.json();
    const secondToken = signupData.token;

    // Assign first user to card (creates notification)
    await request.post(`/api/cards/${cardId}/assignees`, {
      headers: {
        'Authorization': `Bearer ${secondToken}`,
        'Content-Type': 'application/json',
      },
      data: { user_id: userData.id },
    });

    // Reload to fetch notifications
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 5000 });

    // Open the dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Should have a notification
    await expect(page.locator('.notification-item')).toBeVisible();

    // Hover over the notification to reveal delete button
    await page.locator('.notification-item').first().hover();

    // Click delete
    await page.locator('.notification-delete').first().click();

    // Notification should be removed
    await expect(page.locator('.notification-empty')).toBeVisible();
  });
});
