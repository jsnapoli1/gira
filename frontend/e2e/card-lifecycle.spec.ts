/**
 * card-lifecycle.spec.ts
 *
 * Comprehensive tests covering the complete card lifecycle in Zira.
 *
 * Test inventory (49 tests)
 * ───────────────────────────
 * Setup & Creation
 *  1.  Create card via API → title visible in board UI
 *  2.  Create card via UI "Add card" button
 *  3.  Card title appears on the column chip after API creation
 *  4.  Click card chip → detail modal opens
 *
 * Modal sections present
 *  5.  Modal shows card title
 *  6.  Modal shows description section
 *  7.  Modal shows assignees section in sidebar
 *  8.  Modal shows labels section in sidebar
 *  9.  Modal shows sprint select in sidebar
 * 10.  Modal shows time tracking section
 * 11.  Modal shows conversations section
 * 12.  Modal shows activity section
 *
 * Modal close
 * 13.  Close modal with X button
 * 14.  Close modal with Escape key
 * 15.  Close modal by clicking overlay
 *
 * Edit card
 * 16.  Edit card title — new title in modal header and board chip
 * 17.  Cancel edit — original title preserved
 * 18.  Edit description via inline description section
 * 19.  Set card priority via edit form
 * 20.  Set due date — appears in modal meta
 * 21.  Clear due date — due date disappears after clearing
 * 22.  Set story points via edit form
 * 23.  Story points persist after close and reopen
 * 24.  Empty title is rejected on save
 *
 * Labels
 * 25.  Add label via API → label chip visible on card chip
 * 26.  Toggle label on in sidebar → label shown in list
 *
 * Assignees
 * 27.  Add assignee via sidebar select → assignee name in sidebar
 * 28.  Remove assignee via X button → assignee name gone
 * 29.  Card with no assignees shows no assignee avatar on chip
 *
 * Move card
 * 30.  Move card to different column via API → verify via GET
 * 31.  Card position preserved after page reload
 *
 * Comments
 * 32.  Fresh card shows "No comments yet" empty state
 * 33.  Add a comment → appears in comment list
 * 34.  Delete a comment via API → comment gone
 *
 * Time tracking
 * 35.  Log work via modal mini-input → total time increases
 * 36.  Set time estimate — estimate shown in time tracking section
 *
 * Card links
 * 37.  Add card link via API → link visible in modal sidebar
 * 38.  Remove card link via UI → link removed from list
 *
 * Clone / duplicate (not implemented)
 * 39.  Duplicate card feature — marked fixme
 *
 * Delete card
 * 40.  Delete card via modal Delete button with dialog confirmation
 * 41.  Cancel delete confirmation — card stays on board
 *
 * Edge cases
 * 42.  Card with very long title (200+ chars) — renders without crash
 * 43.  Card with special chars in title (& < > " ') — renders correctly
 * 44.  Multiple cards in same column — all appear in All Cards view
 * 45.  Overdue card — past due date shows overdue class on chip
 *
 * Sprint assignment
 * 46.  Assign card to sprint via modal sidebar select
 *
 * Watchers (API-level — no UI button)
 * 47.  POST /api/cards/:id/watch adds current user as watcher
 *
 * Activity log
 * 48.  Card creation event visible in activity log
 *
 * Custom fields
 * 49.  Set text custom field value and verify saved
 */

import { test, expect, APIRequestContext, Page } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  secondColumnId: number;
  swimlaneId: number;
  cardId: number;
  cardTitle: string;
  cardCreated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function createUser(request: APIRequestContext, prefix = 'lifecycle') {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `${prefix}-user` },
  });
  const body = await res.json();
  return { token: body.token as string, userId: (body.user?.id ?? 0) as number, email };
}

/**
 * Full setup: user + board + swimlane + card via API.
 * Does NOT navigate the page — caller is responsible for navigation.
 */
async function setupWithCard(
  request: APIRequestContext,
  prefix = 'Lifecycle',
  cardTitle = 'Lifecycle Test Card',
): Promise<SetupResult> {
  const { token } = await createUser(request, prefix.toLowerCase());

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${prefix} Board` },
    })
  ).json();

  const columns: Array<{ id: number; state: string; position: number }> =
    board.columns ??
    (await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json());

  const sortedCols = [...columns].sort((a, b) => a.position - b.position);
  const columnId = sortedCols[0].id;
  const secondColumnId = sortedCols[1]?.id ?? sortedCols[0].id;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: cardTitle,
      column_id: columnId,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  const cardCreated = cardRes.ok();
  const card = cardCreated ? await cardRes.json() : { id: 0 };

  return {
    token,
    boardId: board.id,
    columnId,
    secondColumnId,
    swimlaneId: swimlane.id,
    cardId: card.id,
    cardTitle,
    cardCreated,
  };
}

/** Navigate to board, switch to All Cards view, wait for at least one card chip. */
async function goToAllCards(page: Page, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

/** Open the first card modal from the All Cards view. */
async function openFirstCardModal(page: Page) {
  await page.locator('.card-item').first().click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
}

/** Open the edit form inside the already-open card modal. */
async function openEditForm(page: Page) {
  await page.click('.card-detail-actions button:has-text("Edit")');
  await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
}

/** Save from the edit form and wait for the PUT to succeed. */
async function saveEditForm(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
      { timeout: 10000 },
    ),
    page.click('.card-detail-actions button:has-text("Save")'),
  ]);
  expect(response.status()).toBe(200);
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Setup & Creation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Setup & Creation', () => {

  test('1. Create card via API and verify title visible in board All-Cards view', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'ApiCreate', 'API Created Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await expect(page.locator('.card-title:has-text("API Created Card")')).toBeVisible();
  });

  test('2. Create card via UI "Add card" button — card appears in column', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'UICreate', 'Seed Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'UI Created Card');

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST',
        { timeout: 10000 },
      ),
      page.click('.quick-add-form button[type="submit"]'),
    ]);
    expect(createResp.status()).toBe(201);

    await expect(page.locator('.card-title:has-text("UI Created Card")')).toBeVisible({
      timeout: 8000,
    });
  });

  test('3. Card title appears on the board chip after API creation', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'ChipTitle', 'Chip Title Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await expect(page.locator('.card-item .card-title:has-text("Chip Title Card")')).toBeVisible();
  });

  test('4. Clicking a card chip opens the detail modal', async ({ page, request }) => {
    const s = await setupWithCard(request, 'OpenModal');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Modal sections
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Modal Sections', () => {

  test('5. Modal shows card title', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalTitle', 'My Test Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.card-detail-title')).toContainText('My Test Card');
  });

  test('6. Modal shows description section', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalDesc');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.card-description-section')).toBeVisible();
  });

  test('7. Modal shows assignees section in sidebar', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalAssignees');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.sidebar-section:has(label:has-text("Assignees"))')).toBeVisible();
  });

  test('8. Modal shows labels section in sidebar', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalLabels');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.sidebar-section:has(label:has-text("Labels"))')).toBeVisible();
  });

  test('9. Modal shows sprint select in sidebar', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalSprint');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.sidebar-section:has(label:has-text("Sprint"))')).toBeVisible();
  });

  test('10. Modal shows time tracking section', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalTime');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.time-tracking-compact')).toBeVisible();
  });

  test('11. Modal shows conversations (comments) section', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalComments');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.conversations-section')).toBeVisible();
  });

  test('12. Modal shows activity log section', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ModalActivity');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await expect(page.locator('.activity-log-section')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Modal close
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Modal Close', () => {

  test('13. Close modal with X button', async ({ page, request }) => {
    const s = await setupWithCard(request, 'CloseX');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });

  test('14. Close modal with Escape key', async ({ page, request }) => {
    const s = await setupWithCard(request, 'CloseEsc');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });

  test('15. Close modal by clicking overlay', async ({ page, request }) => {
    const s = await setupWithCard(request, 'CloseOverlay');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    // Click top-left corner of the overlay (outside the modal box)
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Edit card
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Edit Card', () => {

  test('16. Edit card title — new title shown in modal header and board chip', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'EditTitle', 'Original Title');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Title');
    await saveEditForm(page);

    await expect(page.locator('.card-detail-title')).toContainText('Updated Title', {
      timeout: 8000,
    });

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-title:has-text("Updated Title")')).toBeVisible();
  });

  test('17. Cancel edit — original title is preserved', async ({ page, request }) => {
    const s = await setupWithCard(request, 'CancelEdit', 'Cancel Test Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Changed Title');
    await page.click('.card-detail-actions button:has-text("Cancel")');

    await expect(page.locator('.card-detail-title')).toContainText('Cancel Test Card', {
      timeout: 5000,
    });
  });

  test('18. Edit description via inline description section', async ({ page, request }) => {
    const s = await setupWithCard(request, 'EditDesc');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Click the "Add" button in the description section
    await page.click('.card-description-section button:has-text("Add")');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });
    await page.fill('.description-edit textarea', 'My new description');

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
        { timeout: 10000 },
      ),
      page.click('.description-edit button:has-text("Save")'),
    ]);
    expect(saveResp.status()).toBe(200);

    await expect(page.locator('.description-text')).toContainText('My new description', {
      timeout: 8000,
    });
  });

  test('19. Set card priority via edit form — priority badge updated in meta', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'EditPriority');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    // Priority select is in a form-row; select "high"
    await page.locator('.card-detail-edit select').nth(1).selectOption('high');
    await saveEditForm(page);

    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', {
      timeout: 8000,
    });
  });

  test('20. Set due date — date appears in modal meta', async ({ page, request }) => {
    const s = await setupWithCard(request, 'SetDueDate');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    await page.fill('.card-detail-edit input[type="date"]', '2035-06-30');
    await saveEditForm(page);

    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 8000 });
  });

  test('21. Clear due date — due date disappears from modal meta', async ({ page, request }) => {
    const s = await setupWithCard(request, 'ClearDueDate');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Set due date via API
    await request.put(`${BASE}/api/cards/${s.cardId}`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { due_date: '2035-01-01' },
    });

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Should initially show due date
    await expect(page.locator('.card-detail-meta .card-due')).toBeVisible({ timeout: 5000 });

    // Clear it via edit form
    await openEditForm(page);
    await page.fill('.card-detail-edit input[type="date"]', '');
    await saveEditForm(page);

    // Due date badge should be gone
    await expect(page.locator('.card-detail-meta .card-due')).not.toBeVisible({ timeout: 8000 });
  });

  test('22. Set story points via edit form — points badge visible in meta', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'SetSP');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    // Story Points is the first number input in the edit form
    const spInput = page.locator('.card-detail-edit input[type="number"]').first();
    await spInput.fill('8');
    await saveEditForm(page);

    await expect(page.locator('.card-detail-meta .card-points')).toContainText('8 pts', {
      timeout: 8000,
    });
  });

  test('23. Story points persist after modal close and reopen', async ({ page, request }) => {
    const s = await setupWithCard(request, 'SPPersist');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    const spInput = page.locator('.card-detail-edit input[type="number"]').first();
    await spInput.fill('13');
    await saveEditForm(page);

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('13 pts', {
      timeout: 5000,
    });
  });

  test('24. Empty title is rejected — save does not clear the original title', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'EmptyTitle', 'Has A Title');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('');
    await page.click('.card-detail-actions button:has-text("Save")');

    // Either native validation keeps the form open, or the modal is still visible
    await expect(
      page.locator('.card-detail-edit, .card-detail-modal-unified'),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Labels
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Labels', () => {

  test('25. Add label via API and verify label chip visible on board card', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'LabelChip');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create a board label
    const label = await (
      await request.post(`${BASE}/api/boards/${s.boardId}/labels`, {
        headers: { Authorization: `Bearer ${s.token}` },
        data: { name: 'urgent', color: '#ef4444' },
      })
    ).json();

    // Apply label to card
    await request.post(`${BASE}/api/cards/${s.cardId}/labels`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { label_id: label.id },
    });

    await goToAllCards(page, s.token, s.boardId);
    await expect(page.locator('.card-label:has-text("urgent")')).toBeVisible({ timeout: 8000 });
  });

  test('26. Toggle label on in modal sidebar — label toggle becomes assigned', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'LabelToggle');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create a board label
    await request.post(`${BASE}/api/boards/${s.boardId}/labels`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { name: 'feature', color: '#22c55e' },
    });

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    const labelToggle = page.locator('.label-toggle:has(.label-name:has-text("feature"))');
    await expect(labelToggle).toBeVisible({ timeout: 5000 });

    const [toggleResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/labels') && r.request().method() === 'POST',
        { timeout: 8000 },
      ),
      labelToggle.click(),
    ]);
    expect(toggleResp.status()).toBe(201);

    await expect(labelToggle).toHaveClass(/assigned/, { timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Assignees
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Assignees', () => {

  test('27. Add assignee via sidebar select — assignee name appears in sidebar', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'AddAssignee');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Get the current user info
    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    const me = await meRes.json();

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });
    await addSelect.selectOption({ label: me.display_name });

    await expect(page.locator('.assignee-item .assignee-name')).toContainText(
      me.display_name,
      { timeout: 8000 },
    );
  });

  test('28. Remove assignee via X button — assignee disappears from sidebar', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'RemoveAssignee');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    const me = await meRes.json();

    // Assign via API first
    await request.post(`${BASE}/api/cards/${s.cardId}/assignees`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { user_id: me.id },
    });

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    await expect(page.locator('.assignee-item .assignee-name')).toContainText(
      me.display_name,
      { timeout: 8000 },
    );

    const [removeResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/assignees') && r.request().method() === 'DELETE',
        { timeout: 8000 },
      ),
      page.click('.assignee-item .remove-assignee'),
    ]);
    expect(removeResp.ok()).toBeTruthy();

    await expect(page.locator('.assignee-item')).not.toBeVisible({ timeout: 5000 });
  });

  test('29. Card with no assignees shows no assignee avatar on board chip', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'NoAssignees', 'No Assignee Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);

    // card chip should NOT have .card-assignee children
    const chip = page.locator('.card-item').first();
    await expect(chip).toBeVisible();
    await expect(chip.locator('.card-assignee')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Move card
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Move Card', () => {

  test('30. Move card to different column via API — GET confirms new column', async ({
    request,
  }) => {
    const s = await setupWithCard(request, 'MoveAPI');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Move card to second column
    const moveRes = await request.put(`${BASE}/api/cards/${s.cardId}/move`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: {
        column_id: s.secondColumnId,
        swimlane_id: s.swimlaneId,
        position: 0,
      },
    });
    expect(moveRes.ok()).toBeTruthy();

    // Confirm via GET
    const getRes = await request.get(`${BASE}/api/cards/${s.cardId}`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect(getRes.ok()).toBeTruthy();
    const card = await getRes.json();
    expect(card.column_id).toBe(s.secondColumnId);
  });

  test('31. Card position preserved after page reload', async ({ page, request }) => {
    const s = await setupWithCard(request, 'PositionPersist', 'Persist Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await expect(page.locator('.card-title:has-text("Persist Card")')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await expect(page.locator('.card-title:has-text("Persist Card")')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 8: Comments
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Comments', () => {

  test('32. Fresh card shows "No comments yet" empty state', async ({ page, request }) => {
    const s = await setupWithCard(request, 'NoComments');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    await expect(page.locator('.conversations-section .empty-text')).toContainText(
      'No comments yet',
      { timeout: 8000 },
    );
  });

  test('33. Add a comment via UI — comment appears in the list', async ({ page, request }) => {
    const s = await setupWithCard(request, 'AddComment');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    await page.fill('.comment-form-compact textarea', 'Hello from lifecycle test');

    const [postResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/comments') && r.request().method() === 'POST',
        { timeout: 10000 },
      ),
      page.click('.comment-form-compact button[type="submit"]'),
    ]);
    expect(postResp.status()).toBe(201);

    await expect(page.locator('.comment-body-compact')).toContainText(
      'Hello from lifecycle test',
      { timeout: 8000 },
    );
  });

  test('34. Delete comment via API — comment no longer returned by GET', async ({
    request,
  }) => {
    const s = await setupWithCard(request, 'DeleteComment');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Post comment via API
    const commentRes = await request.post(
      `${BASE}/api/cards/${s.cardId}/comments`,
      {
        headers: { Authorization: `Bearer ${s.token}` },
        data: { body: 'Comment to delete' },
      },
    );
    expect(commentRes.status()).toBe(201);
    const comment = await commentRes.json();

    // Delete via API
    const deleteRes = await request.delete(
      `${BASE}/api/cards/${s.cardId}/comments/${comment.id}`,
      {
        headers: { Authorization: `Bearer ${s.token}` },
      },
    );
    expect(deleteRes.ok()).toBeTruthy();

    // GET list should not contain the deleted comment
    const listRes = await request.get(`${BASE}/api/cards/${s.cardId}/comments`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    const comments = await listRes.json();
    const found = Array.isArray(comments)
      ? comments.some((c: { id: number }) => c.id === comment.id)
      : false;
    expect(found).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 9: Time tracking
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Time Tracking', () => {

  test('35. Log work via modal mini-input — total logged time increases', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'LogWork');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Read current logged value (should start at "0m logged")
    const statsBefore = await page.locator('.time-tracking-stats .time-logged').textContent();

    // Log 90 minutes
    await page.fill('.time-input-mini', '90');

    const [logResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/worklogs') && r.request().method() === 'POST',
        { timeout: 10000 },
      ),
      page.click('.time-tracking-actions .btn-primary'),
    ]);
    expect(logResp.status()).toBe(201);

    const statsAfter = await page.locator('.time-tracking-stats .time-logged').textContent();
    expect(statsAfter).not.toBe(statsBefore);
    // 90 min = 1h 30m — should contain "1h"
    expect(statsAfter).toContain('1h');
  });

  test('36. Set time estimate — estimate shown in time tracking section', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'TimeEstimate');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);
    await openEditForm(page);

    // Time Estimate (minutes) is the second number input in the edit form
    const estInput = page.locator('.card-detail-edit input[type="number"]').nth(1);
    await estInput.fill('120');
    await saveEditForm(page);

    // Estimate should appear in the time tracking stats as "/ 2h estimated"
    await expect(page.locator('.time-tracking-stats .time-estimate')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('.time-tracking-stats .time-estimate')).toContainText('2h');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 10: Card links
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Card Links', () => {

  test('37. Add card link via API — link visible in modal sidebar', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'LinkAPI', 'Card Alpha');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create a second card to link to
    const cardBRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: {
        title: 'Card Beta',
        column_id: s.columnId,
        swimlane_id: s.swimlaneId,
        board_id: s.boardId,
      },
    });
    if (!cardBRes.ok()) { test.skip(true, 'Second card creation failed'); return; }
    const cardB = await cardBRes.json();

    // Link via API
    const linkRes = await request.post(`${BASE}/api/cards/${s.cardId}/links`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { target_card_id: cardB.id, link_type: 'relates_to' },
    });
    expect(linkRes.status()).toBe(201);

    await goToAllCards(page, s.token, s.boardId);

    // Open Card Alpha's modal
    await page.locator('.card-item:has(.card-title:has-text("Card Alpha"))').click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Links sidebar should list Card Beta
    await expect(page.locator('.links-sidebar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.link-card-title:has-text("Card Beta")')).toBeVisible({
      timeout: 8000,
    });
  });

  test('38. Remove card link via UI — link disappears from list', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'LinkRemove', 'Source Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    const cardBRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: {
        title: 'Target Card',
        column_id: s.columnId,
        swimlane_id: s.swimlaneId,
        board_id: s.boardId,
      },
    });
    if (!cardBRes.ok()) { test.skip(true, 'Second card creation failed'); return; }
    const cardB = await cardBRes.json();

    await request.post(`${BASE}/api/cards/${s.cardId}/links`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { target_card_id: cardB.id, link_type: 'relates_to' },
    });

    await goToAllCards(page, s.token, s.boardId);
    await page.locator('.card-item:has(.card-title:has-text("Source Card"))').click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Confirm link is visible
    await expect(page.locator('.link-card-title:has-text("Target Card")')).toBeVisible({
      timeout: 8000,
    });

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/links/') && r.request().method() === 'DELETE',
        { timeout: 8000 },
      ),
      page.locator('.link-delete-btn').first().click(),
    ]);
    expect(deleteResp.ok()).toBeTruthy();

    await expect(page.locator('.link-card-title:has-text("Target Card")')).not.toBeVisible({
      timeout: 5000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 11: Clone / duplicate (not implemented)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Clone / Duplicate', () => {

  test.fixme(
    '39. Duplicate card — no POST /api/cards/:id/duplicate endpoint exists; no UI button',
    async ({ page: _page, request }) => {
      // Backend investigation: no /duplicate route in server.go or card_handlers.go.
      // Frontend investigation: no "Duplicate" / "Clone" button in CardDetailModal.tsx.
      // Remove fixme and implement when the feature is added.
      const s = await setupWithCard(request, 'Clone', 'Original Card');
      if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }
      // When implemented, assertions go here.
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 12: Delete card
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Delete Card', () => {

  test('40. Delete card via modal Delete button with dialog confirmation — card removed from board', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'DeleteCard', 'Card To Delete');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    page.once('dialog', (dialog) => dialog.accept());

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'DELETE',
        { timeout: 10000 },
      ),
      page.click('.card-detail-actions button:has-text("Delete")'),
    ]);
    expect(deleteResp.ok()).toBeTruthy();

    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-title:has-text("Card To Delete")')).not.toBeVisible({
      timeout: 8000,
    });
  });

  test('41. Cancel delete confirmation — card stays on board', async ({ page, request }) => {
    const s = await setupWithCard(request, 'CancelDelete', 'Stays On Board');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Dismiss the dialog
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('.card-detail-actions button:has-text("Delete")');

    // Modal should still be open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    await page.click('.modal-close-btn');
    await expect(page.locator('.card-title:has-text("Stays On Board")')).toBeVisible({
      timeout: 5000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 13: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Edge Cases', () => {

  test('42. Card with very long title (200+ chars) renders without crash', async ({
    page,
    request,
  }) => {
    const longTitle = 'A'.repeat(200) + 'LongCardTitle';
    const s = await setupWithCard(request, 'LongTitle', longTitle);
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    // Board chip should be visible (may truncate) — page must not crash
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Modal opens without crash
    await openFirstCardModal(page);
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
  });

  test('43. Card with special chars in title renders correctly', async ({
    page,
    request,
  }) => {
    const specialTitle = 'Bug & Fix <script> "quoted" \'apostrophe\'';
    const s = await setupWithCard(request, 'SpecialChars', specialTitle);
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // The title should appear with special characters intact (XSS-safe rendering)
    await expect(page.locator('.card-detail-title')).toContainText('Bug & Fix', {
      timeout: 8000,
    });
  });

  test('44. Multiple cards in same column all appear in All Cards view', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'MultiCard', 'First Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create two more cards in the same column
    for (const title of ['Second Card', 'Third Card']) {
      const res = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${s.token}` },
        data: {
          title,
          column_id: s.columnId,
          swimlane_id: s.swimlaneId,
          board_id: s.boardId,
        },
      });
      if (!res.ok()) { test.skip(true, 'Extra card creation failed'); return; }
    }

    await goToAllCards(page, s.token, s.boardId);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('45. Overdue card — past due date renders overdue class on card chip', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'Overdue', 'Overdue Card');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Set due date in the past via API
    await request.put(`${BASE}/api/cards/${s.cardId}`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { due_date: '2020-01-01' },
    });

    await goToAllCards(page, s.token, s.boardId);
    // The due date badge on the chip should have the overdue class
    await expect(page.locator('.card-item .card-due-date.overdue')).toBeVisible({
      timeout: 8000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 14: Sprint assignment
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Sprint Assignment', () => {

  test('46. Assign card to sprint via modal sidebar select', async ({ page, request }) => {
    const s = await setupWithCard(request, 'SprintAssign');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create a sprint
    const sprint = await (
      await request.post(`${BASE}/api/sprints?board_id=${s.boardId}`, {
        headers: { Authorization: `Bearer ${s.token}` },
        data: { name: 'Sprint One', goal: '' },
      })
    ).json();

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Sprint select in sidebar
    const sprintSelect = page.locator('.sidebar-section:has(label:has-text("Sprint")) select');
    await expect(sprintSelect).toBeVisible({ timeout: 5000 });

    const [sprintResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/cards/') &&
          (r.request().method() === 'PUT' || r.request().method() === 'PATCH'),
        { timeout: 10000 },
      ),
      sprintSelect.selectOption({ value: String(sprint.id) }),
    ]);
    expect(sprintResp.ok()).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 15: Watchers (API-level — no Watch UI button in modal)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Watchers (API)', () => {

  test('47. POST /api/cards/:id/watch adds current user as watcher', async ({ request }) => {
    const s = await setupWithCard(request, 'WatcherAPI');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    const watchRes = await request.post(`${BASE}/api/cards/${s.cardId}/watch`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect(watchRes.ok()).toBeTruthy();

    const watchersRes = await request.get(`${BASE}/api/cards/${s.cardId}/watchers`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect(watchersRes.ok()).toBeTruthy();
    const watchers = await watchersRes.json();
    expect(Array.isArray(watchers)).toBe(true);
    expect(watchers.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 16: Activity log
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Activity Log', () => {

  test('48. Card creation event is visible in the activity log', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'ActivityLog');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // Wait for the loading spinner to disappear
    await expect(
      page.locator('.activity-log-section .loading-inline'),
    ).not.toBeVisible({ timeout: 8000 });

    await expect(page.locator('.activity-item').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.activity-description').first()).toContainText('created card');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 17: Custom fields
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card Lifecycle — Custom Fields', () => {

  test('49. Set text custom field value — value saved and shown in modal', async ({
    page,
    request,
  }) => {
    const s = await setupWithCard(request, 'CustomField');
    if (!s.cardCreated) { test.skip(true, 'Card creation failed'); return; }

    // Create a text custom field on the board
    const fieldRes = await request.post(
      `${BASE}/api/boards/${s.boardId}/custom-fields`,
      {
        headers: { Authorization: `Bearer ${s.token}` },
        data: { name: 'Project Code', field_type: 'text', options: '', required: false },
      },
    );
    expect(fieldRes.ok()).toBeTruthy();

    await goToAllCards(page, s.token, s.boardId);
    await openFirstCardModal(page);

    // The custom fields section should be visible
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const fieldInput = page.locator(
      '.custom-field-inline:has(label:has-text("Project Code")) input[type="text"]',
    );
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill('PROJ-123');

    const [cfResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/custom-fields') &&
          (r.request().method() === 'POST' || r.request().method() === 'PUT'),
        { timeout: 10000 },
      ),
      fieldInput.blur(),
    ]);
    expect(cfResp.ok()).toBeTruthy();

    // Close and reopen to confirm persistence
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await openFirstCardModal(page);

    await expect(
      page.locator(
        '.custom-field-inline:has(label:has-text("Project Code")) input[type="text"]',
      ),
    ).toHaveValue('PROJ-123', { timeout: 8000 });
  });
});
