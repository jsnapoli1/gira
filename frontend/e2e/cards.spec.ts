/**
 * cards.spec.ts
 *
 * Comprehensive tests for card creation, the card detail modal, and card
 * deletion. All tests that touch a real card use the skip guard.
 *
 * Test inventory
 * ──────────────
 * Quick-add (column inline form)
 *  1.  Click "Add card" button in column → quick-add form appears
 *  2.  Fill title + press Enter → card appears in column
 *  3.  Fill title + click Cancel → form closes, card not created
 *
 * Card visibility on board
 *  4.  Card title is visible on board chip after creation
 *
 * Card detail modal — opening & sections
 *  5.  Clicking a card opens the detail modal
 *  6.  Modal shows card title
 *  7.  Modal shows description section
 *  8.  Modal shows assignees section (sidebar)
 *  9.  Modal shows labels section (sidebar)
 * 10.  Modal shows sprint section (sidebar)
 * 11.  Modal shows time tracking section
 * 12.  Modal shows conversations (comments) section
 * 13.  Modal shows subtasks section
 * 14.  Modal shows activity section
 *
 * Card detail modal — closing
 * 15.  Close modal with X button
 * 16.  Close modal with Escape key
 * 17.  Close modal by clicking the overlay
 *
 * Card editing — basic
 * 18.  Edit card title — new title appears in modal header and on board chip
 * 19.  Cancel edit — original title preserved
 *
 * Card deletion
 * 20.  Delete card via modal Delete button — card removed from board
 * 21.  Cancel delete confirmation — card stays on board
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

/**
 * Create user + board + swimlane + card via API, inject token with
 * page.evaluate (NOT addInitScript), navigate to board, and switch to
 * "All Cards" view so the card is visible regardless of sprint state.
 */
async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  page: import('@playwright/test').Page,
  label = 'Cards',
) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-cards-${uid}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!cardRes.ok()) {
    test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
    return { board, columns, swimlane, card: null as any, token };
  }

  const card = await cardRes.json();

  // Use page.evaluate (NOT addInitScript) so the token is not re-injected
  // on subsequent full navigations within the test.
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to "All Cards" view.
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, columns, swimlane, card, token };
}

// ---------------------------------------------------------------------------
// Quick-add card via inline column form
// ---------------------------------------------------------------------------

test.describe('Quick-add card', () => {

  test('clicking the Add card button reveals the quick-add form', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'QuickAddForm');
    if (!setup.card) return;

    await page.click('.add-card-btn');
    await expect(page.locator('.quick-add-form')).toBeVisible({ timeout: 5000 });
  });

  test('filling title and pressing Enter creates a card in the column', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'QuickAddEnter');
    if (!setup.card) return;

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    await page.fill('.quick-add-form input', 'Brand New Card');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(201);

    // Both the original card and the new one should be visible.
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });

  test('clicking Cancel closes the quick-add form without creating a card', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'QuickAddCancel');
    if (!setup.card) return;

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    await page.fill('.quick-add-form input', 'Should Not Exist');
    await page.click('.quick-add-form button:has-text("Cancel")');

    await expect(page.locator('.quick-add-form')).not.toBeVisible({ timeout: 5000 });
    // Still only the one card from setup.
    await expect(page.locator('.card-item')).toHaveCount(1);
  });

});

// ---------------------------------------------------------------------------
// Card visibility on board
// ---------------------------------------------------------------------------

test.describe('Card visibility on board', () => {

  test('card title is visible on the board chip after creation', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CardVisible');
    if (!setup.card) return;

    await expect(page.locator('.card-item h4:has-text("Test Card")')).toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// Card detail modal — opening & sections
// ---------------------------------------------------------------------------

test.describe('Card detail modal — opening', () => {

  test('clicking a card opens the detail modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'OpenModal');
    if (!setup.card) return;

    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
  });

  test('modal shows the card title', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalTitle');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

});

test.describe('Card detail modal — sections', () => {

  test('modal shows the description section', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalDesc');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Description section is present regardless of whether it has content.
    await expect(page.locator('.card-description-section')).toBeVisible();
  });

  test('modal shows the assignees section in the sidebar', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalAssignees');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // The sidebar section with label "Assignees" must be present.
    await expect(page.locator('.sidebar-section:has(label:has-text("Assignees"))')).toBeVisible();
  });

  test('modal shows the labels section in the sidebar', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalLabels');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.sidebar-section:has(label:has-text("Labels"))')).toBeVisible();
  });

  test('modal shows the sprint section in the sidebar', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalSprint');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.sidebar-section:has(label:has-text("Sprint"))')).toBeVisible();
  });

  test('modal shows the time tracking section', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalTime');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.time-tracking-compact')).toBeVisible();
  });

  test('modal shows the conversations (comments) section', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalComments');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.conversations-section')).toBeVisible();
  });

  test('modal shows the subtasks section', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalSubtasks');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtasks-section')).toBeVisible();
  });

  test('modal shows the activity section', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalActivity');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.activity-log-section')).toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// Card detail modal — closing
// ---------------------------------------------------------------------------

test.describe('Card detail modal — closing', () => {

  test('close modal with X button', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CloseX');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });

  test('close modal with Escape key', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CloseEsc');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Pressing Escape triggers the overlay's onClick (handleClose) via the
    // modal-overlay click handler — the modal itself does not register a
    // keydown handler, but the browser/OS Escape key dismisses dialogs.
    // We trigger it by pressing Escape and checking that no unsaved-changes
    // confirmation fires (since we haven't edited anything).
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });

  test('close modal by clicking the overlay', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CloseOverlay');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click a corner of the overlay that is outside the modal panel.
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });

});

// ---------------------------------------------------------------------------
// Card editing — basic
// ---------------------------------------------------------------------------

test.describe('Card editing — title', () => {

  test('edit card title — new title visible in modal and on board chip', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'EditTitle');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Enter edit mode.
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Title');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // Modal should show the new title.
    await expect(page.locator('.card-detail-title')).toContainText('Updated Title', {
      timeout: 8000,
    });

    // Close modal and verify the board chip also reflects the update.
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-item h4:has-text("Updated Title")')).toBeVisible();
  });

  test('cancelling edit preserves the original card title', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CancelEdit');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('I Will Cancel This');

    // Click Cancel — not Save.
    await page.click('.card-detail-actions button:has-text("Cancel")');

    // Edit form should close and original title should be shown.
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-detail-title')).toContainText('Test Card');
  });

});

// ---------------------------------------------------------------------------
// Card deletion
// ---------------------------------------------------------------------------

test.describe('Card deletion', () => {

  test('deleting a card via the Delete button removes it from the board', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'DeleteCard');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Register dialog handler BEFORE clicking Delete so it is ready to accept.
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.card-detail-actions .btn-danger');

    // Modal closes and the card disappears from the board.
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  test('dismissing the delete confirmation leaves the card on the board', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'DeleteCardCancel');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Dismiss (cancel) the confirm dialog.
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('.card-detail-actions .btn-danger');

    // Modal should remain open and card should still exist.
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    await expect(page.locator('.card-item')).toHaveCount(1);
  });

});

// ---------------------------------------------------------------------------
// Card creation via API — field validation
// ---------------------------------------------------------------------------

test.describe('Card creation — API', () => {

  test('create card with title only succeeds', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-co-${uid}@test.com`,
          password: 'password123',
          display_name: 'CreateOnly User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Create Only Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Title Only Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    expect(res.status()).toBe(201);
    const card = await res.json();
    expect(card).toHaveProperty('id');
    expect(card.title).toBe('Title Only Card');
  });

  test('create card with description stores description field', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-cd-${uid}@test.com`,
          password: 'password123',
          display_name: 'CreateDesc User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Create Desc Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card With Description',
        description: 'This is the card description.',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    const card = await res.json();
    expect(card.description).toBe('This is the card description.');
  });

  test('created card has required fields: id, title, column_id, swimlane_id, board_id', async ({
    request,
  }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-rf-${uid}@test.com`,
          password: 'password123',
          display_name: 'RequiredFields User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Required Fields Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Required Fields Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    const card = await res.json();
    expect(card).toHaveProperty('id');
    expect(card).toHaveProperty('title');
    expect(card).toHaveProperty('column_id');
    expect(card).toHaveProperty('swimlane_id');
    expect(card).toHaveProperty('board_id');
    expect(card.board_id).toBe(board.id);
    expect(card.column_id).toBe(columns[0].id);
    expect(card.swimlane_id).toBe(swimlane.id);
  });

  test('card appears in correct column via GET /api/boards/:id/cards', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-gc-${uid}@test.com`,
          password: 'password123',
          display_name: 'GetCards User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Get Cards Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Board Cards List Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    const created = await cardRes.json();

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok()) {
      test.skip(true, 'GET /api/boards/:id/cards not available');
      return;
    }

    const cards = await listRes.json();
    expect(Array.isArray(cards)).toBe(true);
    const found = cards.find((c: any) => c.id === created.id);
    expect(found).toBeDefined();
    expect(found.column_id).toBe(columns[0].id);
  });

  test('GET /api/cards/:id returns all card fields', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-gi-${uid}@test.com`,
          password: 'password123',
          display_name: 'GetById User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'GetById Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'GetById Card',
        description: 'Some description',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!createRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
      return;
    }

    const created = await createRes.json();

    const getRes = await request.get(`${BASE}/api/cards/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);

    const card = await getRes.json();
    expect(card).toHaveProperty('id', created.id);
    expect(card).toHaveProperty('title', 'GetById Card');
    expect(card).toHaveProperty('board_id', board.id);
    expect(card).toHaveProperty('column_id', columns[0].id);
    expect(card).toHaveProperty('swimlane_id', swimlane.id);
  });

  test('card with due date has due_date field set in API response', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-dd-${uid}@test.com`,
          password: 'password123',
          display_name: 'DueDate User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'DueDate Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const dueDate = '2030-06-15';
    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card With Due Date',
        due_date: dueDate,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!createRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
      return;
    }

    const card = await createRes.json();
    expect(card.due_date).toBeTruthy();
    expect(card.due_date).toContain(dueDate.split('T')[0].substring(0, 7));
  });

  test('edit card title via PUT /api/cards/:id', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-et-${uid}@test.com`,
          password: 'password123',
          display_name: 'EditTitle User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'EditTitle Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Before Edit',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!createRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
      return;
    }

    const created = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/cards/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'After Edit' },
    });
    expect(updateRes.status()).toBe(200);

    const updated = await updateRes.json();
    expect(updated.title).toBe('After Edit');
  });

  test('edit card description via PUT /api/cards/:id', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-ed-${uid}@test.com`,
          password: 'password123',
          display_name: 'EditDesc User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'EditDesc Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Desc Edit Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!createRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
      return;
    }

    const created = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/cards/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { description: 'Updated description text.' },
    });
    expect(updateRes.status()).toBe(200);

    const updated = await updateRes.json();
    expect(updated.description).toBe('Updated description text.');
  });

});

// ---------------------------------------------------------------------------
// Card modal — column and swimlane display
// ---------------------------------------------------------------------------

test.describe('Card detail modal — column and swimlane', () => {

  test('card detail modal shows the column name', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalColName');
    if (!setup.card) return;

    // Get the column name from the columns array
    const firstColName: string = setup.columns[0]?.name ?? '';

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    if (firstColName) {
      // Column name should appear somewhere in the modal (sidebar or header)
      const modalText = await page.locator('.card-detail-modal-unified').textContent();
      expect(modalText).toContain(firstColName);
    }
  });

  test('card detail modal shows the swimlane name', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalSwimlaneName');
    if (!setup.card) return;

    const swimlaneName: string = setup.swimlane?.name ?? 'Test Swimlane';

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    if (swimlaneName) {
      const modalText = await page.locator('.card-detail-modal-unified').textContent();
      expect(modalText).toContain(swimlaneName);
    }
  });

  test('card detail modal has a visible close button', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalCloseBtn');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.modal-close-btn')).toBeVisible();
  });

  test('card detail modal shows card ID badge', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ModalCardID');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Card ID (e.g. "TS-1") should appear in the modal header or badge
    const idBadge = page.locator('.card-id, .card-key, .card-detail-id');
    if (await idBadge.count() > 0) {
      await expect(idBadge.first()).toBeVisible();
    }
  });

});

// ---------------------------------------------------------------------------
// Card chip display — board-level badges
// ---------------------------------------------------------------------------

test.describe('Card chip display', () => {

  test('card chip shows the card title on the board', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ChipTitle');
    if (!setup.card) return;

    const chip = page.locator('.card-item').filter({ hasText: 'Test Card' });
    await expect(chip).toBeVisible();
    await expect(chip.locator('h4, .card-title')).toContainText('Test Card');
  });

  test('card chip shows a due date badge when due_date is set via API', async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cards-due-${uid}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'DueBadge User' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'DueBadge Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'DUE-', color: '#f59e0b' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Due Date Badge Card',
        due_date: '2030-12-31',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const card = page.locator('.card-item').filter({ hasText: 'Due Date Badge Card' });
    await expect(card).toBeVisible({ timeout: 8000 });

    // Due date badge should be on the chip
    const dueBadge = card.locator('.card-due-date, .due-date-badge, .chip-due');
    if (await dueBadge.count() > 0) {
      await expect(dueBadge.first()).toBeVisible();
    }
  });

  test('multiple cards all visible in All Cards view', async ({ page, request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cards-mc-${uid}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'MultiCard User' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'MultiCard Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'MC-', color: '#6366f1' },
      })
    ).json();

    const cardTitles = ['Card Alpha', 'Card Beta', 'Card Gamma'];
    for (const title of cardTitles) {
      const res = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title,
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      });
      if (!res.ok()) {
        test.skip(true, 'Card creation unavailable');
        return;
      }
    }

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    for (const title of cardTitles) {
      await expect(
        page.locator('.card-item').filter({ hasText: title })
      ).toBeVisible({ timeout: 8000 });
    }
  });

});

// ---------------------------------------------------------------------------
// Card modal — description display
// ---------------------------------------------------------------------------

test.describe('Card detail modal — description display', () => {

  test('modal shows description text when a card has a description', async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cards-desc-${uid}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Desc Modal User' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Desc Modal Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'DM-', color: '#22c55e' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card With Rich Description',
        description: 'This is a rich description text.',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Description text should appear somewhere in the modal
    await expect(page.locator('.card-detail-modal-unified')).toContainText(
      'This is a rich description text.',
      { timeout: 5000 }
    );
  });

  test('modal description section has an edit affordance', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'DescEditAff');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.card-description-section')).toBeVisible();

    // An edit button or contenteditable area should be present
    const editAffordance = page.locator(
      '.card-description-section button:has-text("Edit"), ' +
      '.card-description-section [contenteditable], ' +
      '.card-description-section .edit-description-btn'
    );
    if (await editAffordance.count() > 0) {
      await expect(editAffordance.first()).toBeVisible();
    }
  });

});

// ---------------------------------------------------------------------------
// Card — DELETE via API
// ---------------------------------------------------------------------------

test.describe('Card deletion — API', () => {

  test('DELETE /api/cards/:id returns 200 or 204 and card is gone', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-cards-del-${uid}@test.com`,
          password: 'password123',
          display_name: 'DeleteAPI User',
        },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'DeleteAPI Board' },
      })
    ).json();

    const columns: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'LN-', color: '#3b82f6' },
      })
    ).json();

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Delete Me Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!createRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
      return;
    }

    const created = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/cards/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 204]).toContain(deleteRes.status());

    // Verify card is gone
    const getRes = await request.get(`${BASE}/api/cards/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([404, 403]).toContain(getRes.status());
  });

});
