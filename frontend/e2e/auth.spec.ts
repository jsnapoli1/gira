import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('Welcome to Zira');
  });

  test('should allow user signup', async ({ page }) => {
    const uniqueEmail = `test-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;

    await page.goto('/signup');
    await expect(page.locator('h1')).toContainText('Create Account');

    await page.fill('#displayName', 'Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard after signup
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should show error for invalid login', async ({ page }) => {
    await page.goto('/login');

    await page.fill('#email', 'nonexistent@example.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible();
  });

  test('should allow user login', async ({ page }) => {
    // First create a user
    const uniqueEmail = `test-login-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;

    await page.goto('/signup');
    await page.fill('#displayName', 'Login Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);

    // Logout by clearing storage
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');

    // Now login
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should navigate between login and signup', async ({ page }) => {
    await page.goto('/login');
    await page.click('text=Create one');
    await expect(page).toHaveURL(/\/signup/);

    await page.click('text=Sign in');
    await expect(page).toHaveURL(/\/login/);
  });
});
