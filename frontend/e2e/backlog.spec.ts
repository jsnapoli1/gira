import { test, expect } from '@playwright/test';

test.describe('Backlog', () => {
  test.beforeEach(async ({ page }) => {
    // Create a unique user, login, and create a board
    const uniqueEmail = `test-backlog-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
    await page.goto('/signup');
    await page.fill('#displayName', 'Backlog Test User');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'password123');
    await page.fill('#confirmPassword', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await page.goto('/boards');

    // Create a board
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Backlog Test Board');
    await page.click('button[type="submit"]:has-text("Create Board")');
    // After creation the app navigates directly to the board detail page
    await page.waitForURL(/\/boards\/\d+/);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Add a swimlane — required for the backlog section to render card rows
    await page.click('button:has-text("Add Swimlane")');
    await expect(page.locator('.modal h2')).toContainText('Add Swimlane');
    await page.fill('input[placeholder="Frontend"]', 'Test Swimlane');
    await page.fill('.modal input[placeholder="owner/repo"]', 'test/repo');
    await page.fill('input[placeholder="FE-"]', 'TS-');
    await page.locator('.color-picker .color-option').first().click();
    await page.click('button[type="submit"]:has-text("Add Swimlane")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
    // Wait for the swimlane to be registered in the filter dropdown
    await page.waitForFunction(() => {
      const selects = Array.from(document.querySelectorAll('.filter-select'));
      return selects.some((sel) =>
        Array.from(sel.querySelectorAll('option')).some((opt) => opt.textContent?.includes('Test Swimlane'))
      );
    }, { timeout: 8000 });
  });

  test('should show backlog header with create sprint button', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Backlog header should be visible with Create Sprint button
    await expect(page.locator('.backlog-header')).toBeVisible();
    await expect(page.locator('.backlog-header h2')).toContainText('Backlog');
    await expect(page.locator('.backlog-header button:has-text("Create Sprint")')).toBeVisible();
  });

  test('should create sprint from backlog header', async ({ page }) => {
    // Go to backlog view
    await page.click('.view-btn:has-text("Backlog")');

    // Click create sprint button in header
    await page.click('.backlog-header button:has-text("Create Sprint")');

    // Modal should appear
    await expect(page.locator('.modal h2')).toContainText('Create Sprint');

    // Fill in sprint details
    await page.fill('input[placeholder="Sprint 1"]', 'New Sprint');
    await page.click('button[type="submit"]:has-text("Create")');

    // Sprint should appear in the sprint panel header
    await expect(page.locator('.backlog-sprint-header h2:has-text("New Sprint")')).toBeVisible();
  });

  test('should reorder backlog cards by dragging the grip handle', async ({ page }) => {
    // Uses @dnd-kit KeyboardSensor: focus the drag handle (which has the keyboard listeners),
    // press Space to pick up, ArrowDown to move, Space to drop.

    await page.click('.view-btn:has-text("Backlog")');

    // Add two cards to the backlog
    const addBtn = page.locator('.backlog-section-header button:has-text("Add")').first();
    await addBtn.click();
    await page.fill('input[placeholder="Enter card title..."]', 'Alpha Card');
    await page.keyboard.press('Enter');
    await expect(page.locator('.backlog-card .card-title').first()).toContainText('Alpha Card');

    await page.locator('.backlog-section-header button:has-text("Add")').first().click();
    await page.fill('input[placeholder="Enter card title..."]', 'Beta Card');
    await page.keyboard.press('Enter');

    // Wait for both cards to render
    await expect(page.locator('.backlog-card')).toHaveCount(2);

    const titlesBefore = await page.locator('.backlog-card .card-title').allTextContents();
    expect(titlesBefore[0]).toBe('Alpha Card');
    expect(titlesBefore[1]).toBe('Beta Card');

    // The .backlog-card-drag element has both @dnd-kit attributes (tabIndex=0) and
    // listeners (onKeyDown) so it is keyboard-focusable and the KeyboardSensor can
    // activate on it. Space picks up, ArrowDown moves, Space drops.
    const firstDragHandle = page.locator('.backlog-card-drag').first();
    await firstDragHandle.focus();

    // Pick up (Space). The KeyboardSensor uses setTimeout to register the move/drop
    // key handler, so we wait briefly before sending subsequent keys.
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    // Move down one position, then drop (Space)
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');

    // After drag the cards should be in reversed order
    await expect(page.locator('.backlog-card')).toHaveCount(2);
    const titlesAfter = await page.locator('.backlog-card .card-title').allTextContents();
    expect(titlesAfter[0]).toBe('Beta Card');
    expect(titlesAfter[1]).toBe('Alpha Card');
  });

  test('should move a backlog card to sprint by dragging', async ({ page }) => {
    // Uses the ArrowRight "Move to sprint" button which is the keyboard-accessible
    // equivalent of dragging a backlog card into the sprint drop zone.
    // (@dnd-kit keyboard DnD only moves between SortableContext items; the sprint
    // drop zone is a useDroppable zone outside any SortableContext, so it is not
    // reachable via Arrow keys alone.)

    await page.click('.view-btn:has-text("Backlog")');

    // Create a sprint first
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Drag Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await expect(page.locator('.backlog-sprint-header')).toBeVisible();

    // Add a card to the backlog
    const addBtn = page.locator('.backlog-section-header button:has-text("Add")').first();
    await addBtn.click();
    await page.fill('input[placeholder="Enter card title..."]', 'Draggable Card');
    await page.keyboard.press('Enter');
    await expect(page.locator('.backlog-card .card-title')).toContainText('Draggable Card');

    // Click the ArrowRight "Move to sprint" button that appears on hover.
    // Force:true is needed because the button is only visible on :hover (opacity: 0 → 1).
    await page.locator('.backlog-move-btn').first().click({ force: true });

    // Card should now appear in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Draggable Card');
    // Backlog section should be empty
    await expect(page.locator('.swimlane-backlog .backlog-card')).toHaveCount(0);
  });
});
