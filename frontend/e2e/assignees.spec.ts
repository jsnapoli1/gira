import { test, expect } from '@playwright/test';

test.describe('Assignees', () => {
  test('should show assignee filter on board', async ({ page }) => {
    // Create a user and login
    const uniqueEmail = `test-assignee-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Assignee Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Assignee Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Check that the filter dropdown exists
    await expect(page.locator('.board-header-filters')).toBeVisible();
    // Get the assignee filter (the one with "All assignees" as first option)
    const assigneeFilter = page.locator('.filter-select').filter({ has: page.locator('option:text("All assignees")') });
    await expect(assigneeFilter).toBeVisible();
    await expect(assigneeFilter.locator('option').first()).toHaveText('All assignees');
  });

  test('should show user in filter dropdown', async ({ page }) => {
    // Create a user and login
    const uniqueEmail = `test-assignee-filter-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Filter Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Filter Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);

    // Check that the user appears in filter dropdown
    const assigneeFilter = page.locator('.filter-select').filter({ has: page.locator('option:text("All assignees")') });
    await expect(assigneeFilter).toBeVisible();
    // The user should appear as an option
    const options = await assigneeFilter.locator('option').allTextContents();
    expect(options.some(opt => opt.includes('Filter Test User'))).toBeTruthy();
  });
});
