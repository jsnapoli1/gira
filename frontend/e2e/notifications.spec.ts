import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

test.describe('Notifications', () => {
  let boardId: string;

  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-notifications-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'password123',
        display_name: 'Notifications Test User',
      },
    })).json();

    // Create a board (response includes columns array)
    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Notifications Test Board' },
    })).json();

    boardId = String(board.id);
    const columns = board.columns;

    // Create a swimlane
    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'NF-' },
    })).json();

    // Create a card
    await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card for Notifications',
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
    const secondUserEmail = `test-notifications-assigner-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
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
    const secondUserEmail = `test-notifications-commenter-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
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

    // After clicking, the badge should disappear (this was the only notification)
    // and the notification should no longer carry the unread class.
    // Re-open the dropdown to verify the read state.
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // The notification badge should be gone (no more unread notifications)
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 5000 });

    // The notification item should no longer have the unread class
    await expect(page.locator('.notification-item.unread')).not.toBeVisible({ timeout: 5000 });
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
    const secondUserEmail = `test-notifications-batch-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
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
    const secondUserEmail = `test-notifications-delete-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
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
