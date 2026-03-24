import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;

/**
 * Shared setup: create a user, board, swimlane, columns, and card all via API,
 * inject the token, navigate to the board, then switch to "All Cards" view.
 */
async function setupBoardWithCard(request: any, page: any, label = 'CardEdit') {
  const email = `test-card-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  // Signup — response: { token, user }
  const { token } = await (
    await request.post(`http://localhost:${PORT}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  // Create board — response is the board object directly (no wrapper)
  const board = await (
    await request.post(`http://localhost:${PORT}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  // Get columns — response is a plain array
  const columns: any[] = await (
    await request.get(`http://localhost:${PORT}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  // Create swimlane (boards start with no swimlanes)
  const swimlane = await (
    await request.post(`http://localhost:${PORT}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  // Create card — response is the card object directly (no wrapper)
  const card = await (
    await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  // Inject token and navigate to board
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to "All Cards" view so cards appear without requiring an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, card, columns, swimlane, token };
}

// ---------------------------------------------------------------------------
// Card Creation
// ---------------------------------------------------------------------------

test.describe('Card Creation', () => {
  test('quick-add card — fill title, submit, card appears in column', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'QuickAdd');

    // Click any add-card-btn — the column already has one card
    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    await page.fill('.quick-add-form input', 'Brand New Card');
    await page.click('.quick-add-form button[type="submit"]');

    // Both the original card and the new one should be visible
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.card-item h4:has-text("Brand New Card")')).toBeVisible();
  });

  test('quick-add cancel — click Cancel button, form closes without creating card', async ({ page, request }) => {
    // Note: The quick-add form has no Escape key handler — only a Cancel button.
    await setupBoardWithCard(request, page, 'QuickAddCancel');

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    await page.fill('.quick-add-form input', 'Should Not Exist');

    // Use the Cancel button (no Escape handler in the component)
    await page.click('.quick-add-form button:has-text("Cancel")');

    // Form should close
    await expect(page.locator('.quick-add-form')).not.toBeVisible({ timeout: 5000 });
    // Still only the one card from setup
    await expect(page.locator('.card-item')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Card Detail Modal
// ---------------------------------------------------------------------------

test.describe('Card Detail Modal', () => {
  test('open card modal — shows card title', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'OpenModal');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

  test('close card modal with X button', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'CloseModal');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Card Editing
// ---------------------------------------------------------------------------

test.describe('Card Editing', () => {
  test('edit card title — new title shown in modal header and on board chip', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'EditTitle');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Enter edit mode
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Clear and type new title
    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Title');

    // Click Save and wait for the PUT response
    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await expect(response.status()).toBe(200);

    // Modal should show new title
    await expect(page.locator('.card-detail-title')).toContainText('Updated Title', { timeout: 8000 });

    // Close modal normally (no unsaved changes at this point)
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Card chip on board should also show new title
    await expect(page.locator('.card-item h4:has-text("Updated Title")')).toBeVisible();
  });

  test('edit card priority to High — priority badge updates', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'EditPriority');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Priority is the 2nd select in the edit form (1st is Issue Type)
    await page.locator('.card-detail-edit select').nth(1).selectOption('high');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await expect(response.status()).toBe(200);

    // Priority badge should show "high"
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 8000 });
  });

  test('edit card story points to 5 — story points shown', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'EditStoryPoints');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Story Points is the first input[type=number] in the edit form
    const spInput = page.locator('.card-detail-edit input[type="number"]').first();
    await spInput.fill('5');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await expect(response.status()).toBe(200);

    // Should show "5 pts" in meta
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('5 pts', { timeout: 8000 });
  });

  test('edit card due date — due date appears in meta', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'EditDueDate');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Set a future due date
    await page.fill('.card-detail-edit input[type="date"]', '2030-12-31');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await expect(response.status()).toBe(200);

    // Due date element should appear in meta
    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 8000 });
  });

  test('cancel edit — original title preserved, no save', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'CancelEdit');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('I Will Cancel This');

    // Click Cancel (not Save)
    await page.click('.card-detail-actions button:has-text("Cancel")');

    // Should exit edit mode and show original title
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

  test('unsaved changes confirm — accept closes modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'UnsavedConfirm');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Make a change to trigger the unsaved-changes guard
    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Changed But Not Saved');

    // Register dialog handler BEFORE the click that triggers it
    page.once('dialog', (dialog: any) => dialog.accept());
    await page.click('.modal-close-btn');

    // Modal should close after accepting the confirm
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Card Deletion
// ---------------------------------------------------------------------------

test.describe('Card Deletion', () => {
  test('delete card from modal — card no longer appears on board', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'DeleteCard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Accept the confirm dialog before triggering delete
    page.once('dialog', (dialog: any) => dialog.accept());
    await page.click('.card-detail-actions .btn-danger');

    // Modal should close and card should be gone
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  test('delete card cancel — card still on board', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'DeleteCardCancel');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Dismiss (cancel) the confirm dialog
    page.once('dialog', (dialog: any) => dialog.dismiss());
    await page.click('.card-detail-actions .btn-danger');

    // Modal should still be open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Close modal normally (no unsaved changes)
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Card still on board
    await expect(page.locator('.card-item')).toHaveCount(1);
  });
});
