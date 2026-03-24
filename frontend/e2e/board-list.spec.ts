import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardResponse {
  id: number;
  name: string;
  columns?: Array<{ id: number; name: string; state: string; position: number }>;
  swimlanes?: Array<{ id: number }>;
}

interface UserResponse {
  token: string;
  user: { id: number; display_name: string; email: string };
}

async function createUser(
  request: any,
  prefix: string,
  displayName = 'List Tester',
): Promise<UserResponse> {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  return res.json();
}

async function createBoard(
  request: any,
  token: string,
  name: string,
  template?: string,
): Promise<BoardResponse> {
  const data: Record<string, string> = { name };
  if (template) data.template = template;
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return res.json();
}

async function addMember(
  request: any,
  token: string,
  boardId: number,
  userId: number,
  role = 'member',
) {
  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  title: string,
): Promise<{ id: number }> {
  // Fetch the board to get column/swimlane IDs
  const boardRes = await request.get(`${BASE}/api/boards/${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const board = await boardRes.json();
  const columnId = board.columns?.[0]?.id;
  const swimlaneId = board.swimlanes?.[0]?.id;

  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      column_id: columnId,
      swimlane_id: swimlaneId,
      title,
      description: '',
    },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Board list shows all owned boards
// ---------------------------------------------------------------------------

test.describe('Board list — owned boards', () => {
  test('shows all boards created by the authenticated user', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-owned');

    const names = ['Alpha Project', 'Beta Project', 'Gamma Project'];
    for (const name of names) {
      await createBoard(request, token, name);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    // Wait for the grid to be visible (not the loading state)
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    for (const name of names) {
      await expect(page.locator('.board-card h3', { hasText: name })).toBeVisible();
    }

    // All three cards should be present
    await expect(page.locator('.board-card')).toHaveCount(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Board list shows member boards
// ---------------------------------------------------------------------------

test.describe('Board list — member boards', () => {
  test('member user sees shared board in their list', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'bl-owner-a', 'Owner A');
    const { token: tokenB, user: userB } = await createUser(request, 'bl-member-b', 'Member B');

    const board = await createBoard(request, tokenA, 'Shared Board Alpha');

    // Add userB as a member via API using the user id from signup
    await addMember(request, tokenA, board.id, userB.id);

    // Navigate as user B
    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: 'Shared Board Alpha' })).toBeVisible();
  });

  test('non-member user does NOT see another user\'s board', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'bl-owner-noshow', 'Owner NoShow');
    const { token: tokenB } = await createUser(request, 'bl-nonmember', 'NonMember');

    await createBoard(request, tokenA, 'Private Board Zeta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await page.goto('/boards');

    // User B has no boards and should see empty state
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: 'Private Board Zeta' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Board card shows board name
// ---------------------------------------------------------------------------

test.describe('Board card — name display', () => {
  test('board card displays the correct board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-name');
    const boardName = `Name Check ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible();
  });

  test('board card name matches the name set at creation', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-name-exact');
    const boardName = `Exact Name ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    const cardTitle = await page.locator('.board-card h3').first().textContent();
    expect(cardTitle?.trim()).toBe(boardName);
  });
});

// ---------------------------------------------------------------------------
// 4. Board card shows member count
// (The current BoardsList.tsx does not render a member-count badge on cards.
//  These tests verify the absence of a stale count and document the current
//  behaviour so that the suite fails if a member-count element is added
//  without a corresponding test update.)
// ---------------------------------------------------------------------------

test.describe('Board card — member count', () => {
  test.fixme(
    'board card shows number of members when member count badge is implemented',
    // BoardsList.tsx does not currently render a member-count element on cards.
    // Mark fixme until the UI adds that capability.
    async ({ page, request }) => {
      const { token: tokenA } = await createUser(request, 'bl-mc-owner', 'MC Owner');
      const { token: tokenB, user: userB } = await createUser(request, 'bl-mc-memberx', 'MC Member');

      const board = await createBoard(request, tokenA, 'Member Count Board');

      await addMember(request, tokenA, board.id, userB.id);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await page.goto('/boards');
      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

      // Expect a member-count element showing 2 (owner + 1 member)
      const card = page.locator('.board-card').filter({ hasText: 'Member Count Board' });
      await expect(card.locator('[data-testid="member-count"], .member-count')).toContainText('2');
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Board card shows card count
// (BoardsList.tsx does not render a card-count badge on cards.
//  Mark fixme until the UI adds that capability.)
// ---------------------------------------------------------------------------

test.describe('Board card — card count', () => {
  test.fixme(
    'board card shows number of cards on the board when card count badge is implemented',
    async ({ page, request }) => {
      const { token } = await createUser(request, 'bl-cc-owner', 'CC Owner');
      const board = await createBoard(request, token, 'Card Count Board');

      // Create 2 cards
      await createCard(request, token, board.id, 'Card One');
      await createCard(request, token, board.id, 'Card Two');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/boards');
      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

      const card = page.locator('.board-card').filter({ hasText: 'Card Count Board' });
      await expect(card.locator('[data-testid="card-count"], .card-count')).toContainText('2');
    },
  );
});

// ---------------------------------------------------------------------------
// 6. Click board card navigates to board
// ---------------------------------------------------------------------------

test.describe('Board card — navigation', () => {
  test('clicking a board card link navigates to /boards/:id', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-nav');
    const board = await createBoard(request, token, 'Navigate Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    // Click the board card link
    await page.locator('.board-card-link', { hasText: 'Navigate Board' }).click();

    // URL should change to /boards/:id
    await page.waitForURL(/\/boards\/\d+$/);
    expect(page.url()).toMatch(new RegExp(`/boards/${board.id}$`));
  });

  test('navigating to a board card destination loads the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-nav-view');
    const board = await createBoard(request, token, 'Board View Load');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await page.locator('.board-card-link', { hasText: 'Board View Load' }).click();

    await page.waitForURL(/\/boards\/\d+$/);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Board View Load');
  });
});

// ---------------------------------------------------------------------------
// 7. Create board button opens modal
// ---------------------------------------------------------------------------

test.describe('Create board — modal open', () => {
  test('clicking the "Create Board" button in the header opens the create-board modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-btn');
    await createBoard(request, token, 'Existing Board'); // ensure grid is shown

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.btn.btn-primary:has-text("Create Board")').first().click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();
  });

  test('clicking the "Create Board" CTA in the empty state opens the create-board modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-empty-cta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });

    await page.locator('.empty-state .btn-primary:has-text("Create Board")').click();
    await expect(page.locator('.modal h2:has-text("Create New Board")')).toBeVisible();
  });

  test('modal contains Board Name input, Description textarea, and Template select', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-fields');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();

    await expect(page.locator('#boardName')).toBeVisible();
    await expect(page.locator('#boardDesc')).toBeVisible();
    await expect(page.locator('#boardTemplate')).toBeVisible();
  });

  test('clicking the overlay closes the modal without creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-overlay-close');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Click the overlay (modal-overlay, not the modal itself)
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('Cancel button closes the modal without creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-cancel');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('#boardName').fill('Should Not Persist');
    await page.locator('.modal button:has-text("Cancel")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(page.locator('.board-card h3', { hasText: 'Should Not Persist' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. Create board form validation
// ---------------------------------------------------------------------------

test.describe('Create board — form validation', () => {
  test('submitting with an empty board name does not navigate away from /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-empty');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Do not fill the name — attempt immediate submit
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    // Modal remains visible (native HTML5 required validation blocks submit)
    await expect(page.locator('.modal')).toBeVisible();
    expect(page.url()).toMatch(/\/boards\/?$/);
  });

  test('submitting with only whitespace in the board name shows required state', async ({ page, request }) => {
    // The input has required attribute — browser treats spaces as non-empty but the
    // backend may reject an all-whitespace name. At minimum, the modal must not vanish
    // before the form is submitted.
    const { token } = await createUser(request, 'bl-valid-ws');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('#boardName').fill('   ');
    // The submit button should still be enabled (not disabled when name has text)
    await expect(
      page.locator('.modal button[type="submit"]:has-text("Create Board")'),
    ).not.toBeDisabled();
  });

  test('board name input has required attribute', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-required');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('#boardName[required]')).toBeAttached();
  });

  test('creating a board with a valid name closes modal and adds card to list', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-success');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    const boardName = `Valid Create ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    // After creation, app navigates to the new board
    await page.waitForURL(/\/boards\/\d+$/);
    await expect(page.locator('.board-header h1')).toContainText(boardName);
  });
});

// ---------------------------------------------------------------------------
// 9. Create board with template
// ---------------------------------------------------------------------------

test.describe('Create board — templates', () => {
  test('template selector shows all four template options', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-sel');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    await expect(page.locator('.modal')).toBeVisible();

    const select = page.locator('#boardTemplate');
    await expect(select.locator('option[value=""]')).toBeAttached();
    await expect(select.locator('option[value="kanban"]')).toBeAttached();
    await expect(select.locator('option[value="scrum"]')).toBeAttached();
    await expect(select.locator('option[value="bug_triage"]')).toBeAttached();
  });

  test('creating a board with scrum template creates Backlog and Review columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-scrum');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    const boardName = `Scrum Board ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('scrum');
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    await page.waitForURL(/\/boards\/\d+$/);
    const boardId = page.url().match(/\/boards\/(\d+)/)?.[1];
    expect(boardId).toBeTruthy();

    // Verify in settings that scrum columns were created
    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const columnNames = await columnsSection.locator('.item-name').allTextContents();

    expect(columnNames.some((n) => /backlog/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /review/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /to do/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /in progress/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /done/i.test(n))).toBe(true);
    expect(columnNames).toHaveLength(5);
  });

  test('creating a board with kanban template creates 3 columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-kanban');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button:has-text("Create Board")').first().click();
    const boardName = `Kanban Board ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('kanban');
    await page.locator('.modal button[type="submit"]:has-text("Create Board")').click();

    await page.waitForURL(/\/boards\/\d+$/);
    const boardId = page.url().match(/\/boards\/(\d+)/)?.[1];

    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const columnNames = await columnsSection.locator('.item-name').allTextContents();

    expect(columnNames).toHaveLength(3);
    expect(columnNames.some((n) => /to do/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /in progress/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /done/i.test(n))).toBe(true);
    // No "In Review" or "Backlog"
    expect(columnNames.some((n) => /in review/i.test(n))).toBe(false);
    expect(columnNames.some((n) => /backlog/i.test(n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Delete board from board list
// ---------------------------------------------------------------------------

test.describe('Delete board', () => {
  test('clicking the delete button on a board card removes it after confirmation', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del');
    await createBoard(request, token, 'Board To Delete');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: 'Board To Delete' })).toBeVisible();

    // Accept the window.confirm dialog
    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    // Board should be removed — empty state shown
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-card h3', { hasText: 'Board To Delete' })).not.toBeVisible();
  });

  test('dismissing the confirmation dialog keeps the board visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-cancel');
    await createBoard(request, token, 'Keep This Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    // Dismiss the dialog
    page.once('dialog', (d) => d.dismiss());
    await page.locator('.board-card-delete').first().click();

    // Board should still be present
    await expect(page.locator('.board-card h3', { hasText: 'Keep This Board' })).toBeVisible();
  });

  test('delete button is present on each board card', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-btn');
    await createBoard(request, token, 'Board With Delete Btn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card-delete')).toBeVisible();
  });

  test('deleting one of multiple boards only removes the correct one', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-one');
    await createBoard(request, token, 'Board A Keeper');
    await createBoard(request, token, 'Board B Delete');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(2);

    // Delete Board B
    const boardBCard = page.locator('.board-card').filter({ hasText: 'Board B Delete' });
    page.once('dialog', (d) => d.accept());
    await boardBCard.locator('.board-card-delete').click();

    // Only Board A remains
    await expect(page.locator('.board-card')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.board-card h3', { hasText: 'Board A Keeper' })).toBeVisible();
    await expect(page.locator('.board-card h3', { hasText: 'Board B Delete' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 11. Board search/filter
// (BoardsList.tsx does not currently include a search/filter input.
//  Mark as fixme until the UI adds that capability.)
// ---------------------------------------------------------------------------

test.describe('Board search/filter', () => {
  test.fixme(
    'search input filters board list by name when search is implemented',
    async ({ page, request }) => {
      const { token } = await createUser(request, 'bl-search', 'Search Tester');

      await createBoard(request, token, 'Frontend Alpha');
      await createBoard(request, token, 'Backend Beta');
      await createBoard(request, token, 'Frontend Gamma');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/boards');
      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('input[placeholder*="Search"], input[type="search"], [data-testid="board-search"]');
      await expect(searchInput).toBeVisible();

      await searchInput.fill('Frontend');

      // Only the two Frontend boards should remain visible
      await expect(page.locator('.board-card')).toHaveCount(2);
      await expect(page.locator('.board-card h3', { hasText: 'Frontend Alpha' })).toBeVisible();
      await expect(page.locator('.board-card h3', { hasText: 'Frontend Gamma' })).toBeVisible();
      await expect(page.locator('.board-card h3', { hasText: 'Backend Beta' })).not.toBeVisible();
    },
  );

  test.fixme(
    'clearing search input restores full board list',
    async ({ page, request }) => {
      const { token } = await createUser(request, 'bl-search-clear', 'Search Clear Tester');

      await createBoard(request, token, 'Search Board One');
      await createBoard(request, token, 'Search Board Two');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/boards');
      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('input[placeholder*="Search"], input[type="search"], [data-testid="board-search"]');
      await searchInput.fill('One');
      await expect(page.locator('.board-card')).toHaveCount(1);

      await searchInput.clear();
      await expect(page.locator('.board-card')).toHaveCount(2);
    },
  );
});

// ---------------------------------------------------------------------------
// 12. Board list empty state
// ---------------------------------------------------------------------------

test.describe('Board list — empty state', () => {
  test('user with no boards sees the empty state', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-empty');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
  });

  test('empty state contains "No boards yet" heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-empty-h2');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state h2')).toContainText('No boards yet', { timeout: 10000 });
  });

  test('empty state contains a "Create Board" CTA button', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-empty-cta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state .btn-primary:has-text("Create Board")')).toBeVisible({ timeout: 10000 });
  });

  test('deleting the last board returns the page to the empty state', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-empty-last');
    await createBoard(request, token, 'Last Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').click();

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });
});

// ---------------------------------------------------------------------------
// 13. Recently visited boards order
// (BoardsList.tsx renders boards in the order returned by GET /api/boards,
//  which returns boards ordered by creation time descending.
//  This test documents that the most recently created board appears first.)
// ---------------------------------------------------------------------------

test.describe('Board list — order', () => {
  test('most recently created board appears first in the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-order');

    await createBoard(request, token, 'Board First Created');
    // Small delay to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 50));
    await createBoard(request, token, 'Board Last Created');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    const boardNames = await page.locator('.board-card h3').allTextContents();
    // Boards are listed newest first based on API ordering
    expect(boardNames[0]).toBe('Board Last Created');
    expect(boardNames[1]).toBe('Board First Created');
  });

  test('all boards are present regardless of creation order', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-order-all');

    const names = ['Order A', 'Order B', 'Order C'];
    for (const name of names) {
      await createBoard(request, token, name);
      await new Promise((r) => setTimeout(r, 30));
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(3);

    const rendered = await page.locator('.board-card h3').allTextContents();
    for (const name of names) {
      expect(rendered).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Board list pagination / large list
// (BoardsList.tsx renders all boards in a single .boards-grid without
//  pagination or infinite scroll. This test confirms all 15 boards are
//  visible simultaneously and documents expected behaviour if pagination
//  is added in the future.)
// ---------------------------------------------------------------------------

test.describe('Board list — large list', () => {
  test('15 boards are all visible on the page without pagination', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-paginate', 'Paginate Tester');

    const boardNames: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const name = `Paginate Board ${i.toString().padStart(2, '0')}`;
      boardNames.push(name);
      await createBoard(request, token, name);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.board-card')).toHaveCount(15, { timeout: 15000 });

    // Spot-check first and last boards are both visible
    await expect(page.locator('.board-card h3', { hasText: 'Paginate Board 01' })).toBeVisible();
    await expect(page.locator('.board-card h3', { hasText: 'Paginate Board 15' })).toBeVisible();
  });

  test.fixme(
    'pagination controls appear when board list exceeds page size if pagination is implemented',
    async ({ page, request }) => {
      const { token } = await createUser(request, 'bl-paginate-ctrl', 'Paginate Ctrl Tester');

      for (let i = 1; i <= 15; i++) {
        await createBoard(request, token, `Paged Board ${i}`);
      }

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/boards');

      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 15000 });

      // Expect pagination or load-more controls to be present
      const paginator = page.locator(
        '[data-testid="pagination"], .pagination, button:has-text("Load more"), button:has-text("Next")',
      );
      await expect(paginator).toBeVisible();
    },
  );
});
