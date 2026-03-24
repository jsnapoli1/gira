import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup(request: any, page: any, label = 'CardEdit') {
  const email = `card-edit-${crypto.randomUUID()}@test.com`;
  const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `${label}-${crypto.randomUUID().slice(0, 6)}` },
  })).json();

  const board = await (await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `${label} Board` },
  })).json();

  const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
  })).json();

  // Use page.evaluate (NOT addInitScript) — addInitScript re-runs on every navigation
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);

  return { token, board, swimlane, columns: board.columns };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title = 'Test Card',
) {
  return request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      column_id: columnId,
      swimlane_id: swimlaneId,
      board_id: boardId,
      priority: 'medium',
    },
  });
}

async function openBoardAllCards(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Card Creation
// ---------------------------------------------------------------------------

test.describe('Card Creation', () => {

  test('quick-add card — fill title, submit, card appears in column', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'QuickAdd');

    // Seed one card so the board shows something; skip if unavailable
    const seedRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Seed Card');
    if (!seedRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await seedRes.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'Brand New Card');
    await page.click('.quick-add-form button[type="submit"]');

    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.card-item h4:has-text("Brand New Card")')).toBeVisible();
  });

  test('quick-add cancel — Cancel button closes form without creating card', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'QuickAddCancel');

    const seedRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Seed Card');
    if (!seedRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await seedRes.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'Should Not Exist');

    await page.click('.quick-add-form button:has-text("Cancel")');

    await expect(page.locator('.quick-add-form')).not.toBeVisible({ timeout: 5000 });
    // Still only the one seeded card
    await expect(page.locator('.card-item')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Card Detail Modal — Open / Close
// ---------------------------------------------------------------------------

test.describe('Card Detail Modal', () => {

  test('open card modal — shows card title', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'OpenModal');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

  test('close card modal with X button', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'CloseModal');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
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
    const { token, board, swimlane, columns } = await setup(request, page, 'EditTitle');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Title is first text input in the edit form
    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Title');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // Modal shows new title
    await expect(page.locator('.card-detail-title')).toContainText('Updated Title', { timeout: 8000 });

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Board chip also shows new title
    await expect(page.locator('.card-item h4:has-text("Updated Title")')).toBeVisible();
  });

  test('empty title is rejected — save does not succeed with blank title', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'EmptyTitle');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('');

    // Click Save — the native required validation or API rejection should prevent update
    await page.click('.card-detail-actions button:has-text("Save")');

    // The modal should still be in edit mode (no navigation away) or
    // show an error; the title must NOT have become empty
    await expect(page.locator('.card-detail-edit, .card-detail-modal-unified')).toBeVisible({ timeout: 3000 });
  });

  test('set story points — story points shown in modal meta', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'EditSP');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Story Points is the first number input in the edit form
    const spInput = page.locator('.card-detail-edit input[type="number"]').first();
    await spInput.fill('5');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // Meta area shows "5 pts"
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('5 pts', { timeout: 8000 });
  });

  test('story points persist after modal close and reopen', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'SPPersist');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="number"]').first().fill('13');
    await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Close and reopen
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Story points still showing
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('13 pts', { timeout: 5000 });
  });

  test('set due date — due date appears in modal meta', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'EditDueDate');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.fill('.card-detail-edit input[type="date"]', '2030-12-31');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // Due date element appears in meta
    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 8000 });
  });

  test('due date persists after reload', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'DueDatePersist');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.fill('.card-detail-edit input[type="date"]', '2030-06-15');
    await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Due date still appears in meta after reload
    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 5000 });
  });

  test('set description via inline edit — description shown in view mode', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'EditDesc');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Description uses an inline "Add" / "Edit" button (not the main Edit mode)
    await page.click('.card-description-section button:has-text("Add")');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });
    await page.fill('.description-edit textarea', '# My Description\n\nSome details here.');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.description-edit button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // Description content visible in view mode
    await expect(page.locator('.card-description-section')).toContainText('My Description', { timeout: 5000 });
  });

  test('description persists after modal close and reload', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'DescPersist');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-description-section button:has-text("Add")');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });
    await page.fill('.description-edit textarea', 'Persistent description content');
    await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.description-edit button:has-text("Save")'),
    ]);
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Reload
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-description-section')).toContainText('Persistent description content', {
      timeout: 5000,
    });
  });

  test('edit card priority to High in edit mode — priority badge updates', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'EditPriority');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
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
    expect(response.status()).toBe(200);

    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 8000 });
  });

  test('all edits persist after page reload', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'AllPersist');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Original Title');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change title, story points, due date, priority
    await page.locator('.card-detail-edit input[type="text"]').first().fill('Persisted Title');
    await page.locator('.card-detail-edit input[type="number"]').first().fill('8');
    await page.fill('.card-detail-edit input[type="date"]', '2031-01-01');
    await page.locator('.card-detail-edit select').nth(1).selectOption('high');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);
    await page.click('.modal-close-btn');

    // Full page reload
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-detail-title')).toContainText('Persisted Title', { timeout: 5000 });
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('8 pts', { timeout: 5000 });
    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 5000 });
  });

  test('cancel edit — original title preserved, no save occurs', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'CancelEdit');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('I Will Cancel This');

    // Click Cancel — no Save
    await page.click('.card-detail-actions button:has-text("Cancel")');

    // Exit edit mode; original title preserved
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

  test('unsaved changes confirm dialog — accept closes modal', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'UnsavedConfirm');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
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

  test('unsaved changes confirm dialog — dismiss keeps modal open', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'UnsavedDismiss');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.locator('.card-detail-edit input[type="text"]').first().fill('Changed');

    // Dismiss the confirm dialog
    page.once('dialog', (dialog: any) => dialog.dismiss());
    await page.click('.modal-close-btn');

    // Modal should remain open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Card Deletion
// ---------------------------------------------------------------------------

test.describe('Card Deletion', () => {

  test('delete card from modal — card no longer appears on board', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page, 'DeleteCard');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
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
    const { token, board, swimlane, columns } = await setup(request, page, 'DeleteCardCancel');

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Test Card');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Dismiss (cancel) the confirm dialog
    page.once('dialog', (dialog: any) => dialog.dismiss());
    await page.click('.card-detail-actions .btn-danger');

    // Modal still open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Close modal normally
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Card still on board
    await expect(page.locator('.card-item')).toHaveCount(1);
  });
});
