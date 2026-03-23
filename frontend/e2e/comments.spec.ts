import { test, expect } from '@playwright/test';

test.describe('Comments', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user and login
    const uniqueEmail = `test-comments-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Comment Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Comment Test Board');
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
    await page.fill('.quick-add-form input', 'Test Card for Comments');
    await page.click('.quick-add-form button[type="submit"]');
    await page.waitForSelector('.card-item', { timeout: 5000 });
  });

  test('should show empty comments state', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Conversations section is always visible inline (no tab needed)
    await expect(page.locator('.conversations-section')).toBeVisible();

    // Should show no comments message (scoped to the conversations section)
    await expect(page.locator('.conversations-section .empty-text')).toBeVisible();
    await expect(page.locator('.conversations-section .empty-text')).toContainText('No comments yet');
  });

  test('should add a comment to a card', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Add a comment using the inline form
    await page.fill('.comment-form-compact textarea', 'This is my first comment!');
    await page.click('.comment-form-compact button[type="submit"]');

    // Should show the comment
    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.comment-body-compact')).toContainText('This is my first comment!');
  });

  test('should show comment author and timestamp', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Add a comment
    await page.fill('.comment-form-compact textarea', 'A comment with metadata');
    await page.click('.comment-form-compact button[type="submit"]');

    // Should show author name
    await expect(page.locator('.comment-author').first()).toContainText('Comment Test User');

    // Should show timestamp
    await expect(page.locator('.comment-time').first()).toBeVisible();
  });

  test('should add multiple comments in order', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Add first comment
    await page.fill('.comment-form-compact textarea', 'First comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(page.locator('.comment-item-compact')).toHaveCount(1, { timeout: 5000 });

    // Add second comment
    await page.fill('.comment-form-compact textarea', 'Second comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(page.locator('.comment-item-compact')).toHaveCount(2, { timeout: 5000 });

    // Add third comment
    await page.fill('.comment-form-compact textarea', 'Third comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(page.locator('.comment-item-compact')).toHaveCount(3, { timeout: 5000 });

    // Verify order
    const comments = page.locator('.comment-body-compact');
    await expect(comments.nth(0)).toContainText('First comment');
    await expect(comments.nth(1)).toContainText('Second comment');
    await expect(comments.nth(2)).toContainText('Third comment');
  });

  test('should persist comments after closing modal', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Add a comment
    await page.fill('.comment-form-compact textarea', 'Persistent comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Comment should still be there
    await expect(page.locator('.comment-body-compact')).toContainText('Persistent comment');
  });

  test('should clear textarea after posting comment', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Add a comment
    await page.fill('.comment-form-compact textarea', 'Test comment');
    await page.click('.comment-form-compact button[type="submit"]');

    // Wait for comment to appear
    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 5000 });

    // Textarea should be cleared
    await expect(page.locator('.comment-form-compact textarea')).toHaveValue('');
  });

  test('should disable submit button when textarea is empty', async ({ page }) => {
    // Click on the card to open detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Submit button should be disabled initially
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeDisabled();

    // Type something
    await page.fill('.comment-form-compact textarea', 'Some text');
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeEnabled();

    // Clear textarea
    await page.fill('.comment-form-compact textarea', '');
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeDisabled();
  });
});
