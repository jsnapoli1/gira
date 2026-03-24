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

// ---------------------------------------------------------------------------
// 1. Empty state
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

    await expect(
      page.locator('.empty-state .btn-primary', { hasText: 'Create Board' })
    ).toBeVisible({ timeout: 10000 });
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
// 2. Create board button visibility
// ---------------------------------------------------------------------------

test.describe('Board list — create board button', () => {
  test('"Create Board" button is visible in the page header when boards exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-btn-exists');
    await createBoard(request, token, 'Existing Board For Btn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.btn.btn-primary', { hasText: 'Create Board' }).first()).toBeVisible();
  });

  test('"Create Board" button is visible via empty-state CTA when no boards exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-btn-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('.empty-state .btn-primary', { hasText: 'Create Board' })
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Create board modal opens
// ---------------------------------------------------------------------------

test.describe('Board list — create board modal', () => {
  test('clicking the header "Create Board" button opens the modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-btn');
    await createBoard(request, token, 'Existing Board Modal Btn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.btn.btn-primary', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal h2', { hasText: 'Create New Board' })).toBeVisible();
  });

  test('clicking the empty-state CTA opens the create board modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });

    await page.locator('.empty-state .btn-primary', { hasText: 'Create Board' }).click();
    await expect(page.locator('.modal h2', { hasText: 'Create New Board' })).toBeVisible();
  });

  test('modal contains Board Name input, Description textarea, and Template select', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-fields');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();

    await expect(page.locator('#boardName')).toBeVisible();
    await expect(page.locator('#boardDesc')).toBeVisible();
    await expect(page.locator('#boardTemplate')).toBeVisible();
  });

  test('clicking the overlay closes the modal without creating a board', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-overlay-close');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Click modal-overlay outside the modal box
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-modal-cancel');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('#boardName').fill('Should Not Persist');
    await page.locator('.modal .btn', { hasText: 'Cancel' }).click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      page.locator('.board-card h3', { hasText: 'Should Not Persist' })
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Create board form — validation
// ---------------------------------------------------------------------------

test.describe('Board list — form validation', () => {
  test('board name input has required attribute', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-required');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('#boardName[required]')).toBeAttached();
  });

  test('submitting with an empty name keeps the modal open', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    // HTML5 required validation blocks submission — modal stays open
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page).toHaveURL(/\/boards\/?$/);
  });
});

// ---------------------------------------------------------------------------
// 5. Fill name and submit creates board
// ---------------------------------------------------------------------------

test.describe('Board list — create board with valid name', () => {
  test('filling name and submitting navigates to the new board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-valid-success');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    const boardName = `Valid Create ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    // After creation the app navigates to the new board
    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText(boardName);
  });
});

// ---------------------------------------------------------------------------
// 6. Board appears in list after creation
// ---------------------------------------------------------------------------

test.describe('Board list — board appears after creation', () => {
  test('board created via API appears in the boards grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-appears');
    const boardName = `Appears Board ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card h3', { hasText: boardName })).toBeVisible();
  });

  test('multiple boards all appear in the list', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-multiple');
    const names = ['Alpha Project', 'Beta Project', 'Gamma Project'];
    for (const name of names) {
      await createBoard(request, token, name);
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    for (const name of names) {
      await expect(page.locator('.board-card h3', { hasText: name })).toBeVisible();
    }
    await expect(page.locator('.board-card')).toHaveCount(3);
  });
});

// ---------------------------------------------------------------------------
// 7. Click board card navigates to board view
// ---------------------------------------------------------------------------

test.describe('Board list — click board navigates', () => {
  test('clicking a board card link navigates to /boards/:id', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-nav');
    const board = await createBoard(request, token, 'Navigate Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'Navigate Board' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    expect(page.url()).toMatch(new RegExp(`/boards/${board.id}$`));
  });

  test('navigating to a board loads the board view page', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-nav-view');
    const board = await createBoard(request, token, 'Board View Load');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'Board View Load' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Board View Load');
  });
});

// ---------------------------------------------------------------------------
// 8. Delete board from list
// ---------------------------------------------------------------------------

test.describe('Board list — delete board', () => {
  test('delete button is present on each board card', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-btn');
    await createBoard(request, token, 'Board With Delete Btn');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.board-card-delete')).toBeVisible();
  });

  test('clicking delete and confirming removes the board', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del');
    await createBoard(request, token, 'Board To Delete');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.board-card h3', { hasText: 'Board To Delete' })
    ).not.toBeVisible();
  });

  test('dismissing the confirmation dialog keeps the board visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-cancel');
    await createBoard(request, token, 'Keep This Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.dismiss());
    await page.locator('.board-card-delete').first().click();

    await expect(page.locator('.board-card h3', { hasText: 'Keep This Board' })).toBeVisible();
  });

  test('deleting one of multiple boards removes only the correct one', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-del-one');
    await createBoard(request, token, 'Board A Keeper');
    await createBoard(request, token, 'Board B Delete');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-card')).toHaveCount(2);

    const boardBCard = page.locator('.board-card').filter({ hasText: 'Board B Delete' });
    page.once('dialog', (d) => d.accept());
    await boardBCard.locator('.board-card-delete').click();

    await expect(page.locator('.board-card')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.board-card h3', { hasText: 'Board A Keeper' })).toBeVisible();
    await expect(
      page.locator('.board-card h3', { hasText: 'Board B Delete' })
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 9. Multiple boards shown
// ---------------------------------------------------------------------------

test.describe('Board list — multiple boards', () => {
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

    await expect(page.locator('.board-card h3', { hasText: 'Paginate Board 01' })).toBeVisible();
    await expect(page.locator('.board-card h3', { hasText: 'Paginate Board 15' })).toBeVisible();
  });

  test('boards are listed and both appear in the grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-order');

    const firstName = `Board-Alpha-${crypto.randomUUID().slice(0, 8)}`;
    const lastName = `Board-Beta-${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, firstName);
    await createBoard(request, token, lastName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    // Both boards should be visible in the grid
    await expect(page.locator('.board-card h3', { hasText: firstName })).toBeVisible();
    await expect(page.locator('.board-card h3', { hasText: lastName })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 10. Member boards
// ---------------------------------------------------------------------------

test.describe('Board list — member boards', () => {
  test('a board shared with a user appears in that user\'s board list', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'bl-owner-a', 'Owner A');
    const { token: tokenB, user: userB } = await createUser(request, 'bl-member-b', 'Member B');

    const board = await createBoard(request, tokenA, 'Shared Board Alpha');
    await addMember(request, tokenA, board.id, userB.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.board-card h3', { hasText: 'Shared Board Alpha' })
    ).toBeVisible();
  });

  test('non-member user does NOT see another user\'s private board', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'bl-owner-noshow', 'Owner NoShow');
    const { token: tokenB } = await createUser(request, 'bl-nonmember', 'NonMember');

    await createBoard(request, tokenA, 'Private Board Zeta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.board-card h3', { hasText: 'Private Board Zeta' })
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 11. Board shows description when set
// ---------------------------------------------------------------------------

test.describe('Board list — board card details', () => {
  test('board card shows the board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-name');
    const boardName = `Name Check ${crypto.randomUUID().slice(0, 8)}`;
    await createBoard(request, token, boardName);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
    const cardTitle = await page.locator('.board-card h3').first().textContent();
    expect(cardTitle?.trim()).toBe(boardName);
  });
});

// ---------------------------------------------------------------------------
// 12. Board templates
// ---------------------------------------------------------------------------

test.describe('Board list — templates', () => {
  test('template selector shows all four template options', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-sel');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    const select = page.locator('#boardTemplate');
    await expect(select.locator('option[value=""]')).toBeAttached();
    await expect(select.locator('option[value="kanban"]')).toBeAttached();
    await expect(select.locator('option[value="scrum"]')).toBeAttached();
    await expect(select.locator('option[value="bug_triage"]')).toBeAttached();
  });

  test('creating a board with kanban template creates 3 columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-kanban');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    const boardName = `Kanban Board ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('kanban');
    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    const boardId = page.url().match(/\/boards\/(\d+)/)?.[1];

    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const columnNames = await columnsSection.locator('.item-name').allTextContents();

    expect(columnNames).toHaveLength(3);
    expect(columnNames.some((n) => /to do/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /in progress/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /done/i.test(n))).toBe(true);
  });

  test('creating a board with scrum template creates Backlog and Review columns', async ({ page, request }) => {
    const { token } = await createUser(request, 'bl-tpl-scrum');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    const boardName = `Scrum Board ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator('#boardName').fill(boardName);
    await page.locator('#boardTemplate').selectOption('scrum');
    await page.locator('.modal button[type="submit"]', { hasText: 'Create Board' }).click();

    await page.waitForURL(/\/boards\/\d+$/, { timeout: 10000 });
    const boardId = page.url().match(/\/boards\/(\d+)/)?.[1];

    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const columnNames = await columnsSection.locator('.item-name').allTextContents();

    expect(columnNames.some((n) => /backlog/i.test(n))).toBe(true);
    expect(columnNames.some((n) => /review/i.test(n))).toBe(true);
    expect(columnNames).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 13. Board search/filter (not yet implemented — fixme)
// ---------------------------------------------------------------------------

test.describe('Board list — search/filter (not yet implemented)', () => {
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

      const searchInput = page.locator(
        'input[placeholder*="Search"], input[type="search"], [data-testid="board-search"]',
      );
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Frontend');

      await expect(page.locator('.board-card')).toHaveCount(2);
      await expect(page.locator('.board-card h3', { hasText: 'Frontend Alpha' })).toBeVisible();
      await expect(page.locator('.board-card h3', { hasText: 'Frontend Gamma' })).toBeVisible();
      await expect(
        page.locator('.board-card h3', { hasText: 'Backend Beta' })
      ).not.toBeVisible();
    },
  );
});

// ---------------------------------------------------------------------------
// 14. Member count badge (not yet implemented — fixme)
// ---------------------------------------------------------------------------

test.describe('Board list — member count (not yet implemented)', () => {
  test.fixme(
    'board card shows number of members when member count badge is implemented',
    async ({ page, request }) => {
      const { token: tokenA } = await createUser(request, 'bl-mc-owner', 'MC Owner');
      const { token: tokenB, user: userB } = await createUser(request, 'bl-mc-member', 'MC Member');
      const board = await createBoard(request, tokenA, 'Member Count Board');
      await addMember(request, tokenA, board.id, userB.id);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenA);
      await page.goto('/boards');
      await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

      const card = page.locator('.board-card').filter({ hasText: 'Member Count Board' });
      await expect(
        card.locator('[data-testid="member-count"], .member-count')
      ).toContainText('2');
    },
  );
});
