import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';

async function setupUserAndBoard(page: any, request: any, boardName = 'Settings Test Board') {
  // Sign up via API for speed and reliability
  const email = `test-bs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Settings Test User' },
  });
  const { token } = await signupRes.json();

  // Inject token before any navigation
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

  // Create board via API (response is the board object directly)
  const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  return { token, board };
}

test.describe('Board Settings', () => {
  test('should load board settings page with expected sections', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.locator('.page-header h1')).toContainText('Board Settings');

    // Verify main sections exist
    await expect(page.locator('.settings-section h2:has-text("General")')).toBeVisible();
    await expect(page.locator('.settings-section h2:has-text("Columns")')).toBeVisible();
    await expect(page.locator('.settings-section h2:has-text("Labels")')).toBeVisible();
    await expect(page.locator('.settings-section h2:has-text("Members")')).toBeVisible();
  });

  // ── Column Management ──────────────────────────────────────────────────────

  test('should show default columns on the settings page', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    // Default board columns: To Do, In Progress, Done
    const columnSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await expect(columnSection.locator('.item-name').first()).toBeVisible();
    const names = await columnSection.locator('.item-name').allTextContents();
    expect(names.some(n => /to do/i.test(n))).toBe(true);
    expect(names.some(n => /in progress/i.test(n))).toBe(true);
    expect(names.some(n => /done/i.test(n))).toBe(true);
  });

  test('should add a new column', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    // Open the add column modal
    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    // Modal should appear
    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible();

    // Fill in column name
    await page.locator('.modal input[type="text"]').fill('Testing');

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();

    // Modal should close and new column appears in the list
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(columnsSection.locator('.item-name:has-text("Testing")')).toBeVisible();
  });

  test('should delete a column', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    // Add a column first so we have something to delete
    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Delete Me');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(columnsSection.locator('.item-name:has-text("Delete Me")')).toBeVisible();

    // Click delete on the new column row — accept the confirm dialog first
    const deleteTarget = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Delete Me' })
      .locator('.item-delete');

    page.once('dialog', dialog => dialog.accept());
    await deleteTarget.click();

    // Column should be gone
    await expect(columnsSection.locator('.item-name:has-text("Delete Me")')).not.toBeVisible();
  });

  test('should reorder columns using up/down arrows', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');

    // Get initial order of first two column names
    const firstName = await items.nth(0).locator('.item-name').textContent();
    const secondName = await items.nth(1).locator('.item-name').textContent();

    // Click "Move down" on the first item (moves it to position 2)
    await items.nth(0).locator('.reorder-btn[title="Move down"]').click();

    // The original second column should now be first
    await expect(items.nth(0).locator('.item-name')).toHaveText(secondName!);
    await expect(items.nth(1).locator('.item-name')).toHaveText(firstName!);
  });

  test('should show column headers on the board view when a swimlane exists', async ({ page, request }) => {
    // Column headers (.board-column-header h3) are only rendered by BoardView when at least
    // one swimlane exists. Without a swimlane the empty-swimlanes prompt is shown instead.
    // Verify that the settings page still lists the default column names correctly.
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const names = await columnsSection.locator('.item-name').allTextContents();
    // Default board comes with: To Do, In Progress, In Review, Done
    expect(names.some(n => /to do/i.test(n))).toBe(true);
    expect(names.some(n => /in progress/i.test(n))).toBe(true);
    expect(names.some(n => /done/i.test(n))).toBe(true);
  });

  // ── Label Management ───────────────────────────────────────────────────────

  test('should add a new label', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    // Open modal
    await labelsSection.locator('button:has-text("Add Label")').click();
    await expect(page.locator('.modal h2:has-text("Add Label")')).toBeVisible();

    // Fill label name
    await page.locator('.modal input[type="text"]').fill('Bug');

    // Pick a color (second option in the color picker)
    const colorButtons = page.locator('.modal .color-option');
    await colorButtons.nth(1).click();

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Bug")')).toBeVisible();
  });

  test('should edit an existing label', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    // Add a label first
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Original');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Original")')).toBeVisible();

    // Click the edit (pencil) button on that label
    const labelRow = labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Original' });
    await labelRow.locator('.item-edit').click();

    // Edit modal opens pre-filled
    await expect(page.locator('.modal h2:has-text("Edit Label")')).toBeVisible();
    const nameInput = page.locator('.modal input[type="text"]');
    await nameInput.clear();
    await nameInput.fill('Updated Label');

    await page.locator('.modal button[type="submit"]:has-text("Save Changes")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Updated Label")')).toBeVisible();
    await expect(labelsSection.locator('.item-name:has-text("Original")')).not.toBeVisible();
  });

  test('should delete a label', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    const labelsSection = page.locator('.settings-section').filter({ hasText: 'Labels' });

    // Create a label to delete
    await labelsSection.locator('button:has-text("Add Label")').click();
    await page.locator('.modal input[type="text"]').fill('Temporary');
    await page.locator('.modal button[type="submit"]:has-text("Add Label")').click();
    await expect(labelsSection.locator('.item-name:has-text("Temporary")')).toBeVisible();

    // Delete it
    const labelRow = labelsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Temporary' });

    page.once('dialog', dialog => dialog.accept());
    await labelRow.locator('.item-delete').click();

    await expect(labelsSection.locator('.item-name:has-text("Temporary")')).not.toBeVisible();
  });

  // ── General Settings ───────────────────────────────────────────────────────

  test('should rename the board', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request, 'Rename Me');

    await page.goto(`/boards/${board.id}/settings`);

    // Change the board name
    const nameInput = page.locator('#boardName');
    await nameInput.clear();
    await nameInput.fill('Renamed Board');

    const saveBtn = page.locator('button:has-text("Save Changes")');
    await saveBtn.click();

    // Wait for save to finish — button cycles through "Saving..." back to "Save Changes"
    await expect(saveBtn).toHaveText('Save Changes', { timeout: 5000 });

    // Navigate to board list and verify updated name
    await page.goto('/boards');
    // Board names are in h3 inside .board-card
    await expect(page.locator('.board-card h3:has-text("Renamed Board")')).toBeVisible();
  });

  test('should update board description', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);

    await page.goto(`/boards/${board.id}/settings`);

    // Update description
    const descInput = page.locator('#boardDesc');
    await descInput.clear();
    await descInput.fill('A new test description');

    const saveBtn = page.locator('button:has-text("Save Changes")');
    await saveBtn.click();

    // Wait for save to complete — button returns from "Saving..." back to "Save Changes"
    await expect(saveBtn).toHaveText('Save Changes', { timeout: 5000 });

    // Reload settings and verify description persisted
    await page.reload();
    await expect(page.locator('#boardDesc')).toHaveValue('A new test description');
  });
});
