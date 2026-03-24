import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  columnId: number;
  closedColumnId: number;
  swimlaneId: number;
}

async function setupBoard(
  request: import('@playwright/test').APIRequestContext,
  page: import('@playwright/test').Page,
  prefix = 'overdue',
): Promise<BoardSetup> {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Overdue Tester' },
  });
  expect(signupRes.ok(), `signup failed: ${await signupRes.text()}`).toBeTruthy();
  const token: string = (await signupRes.json()).token;

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Overdue Test Board' },
  });
  expect(boardRes.ok(), `createBoard failed: ${await boardRes.text()}`).toBeTruthy();
  const boardId: number = (await boardRes.json()).id;

  const columnsRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(columnsRes.ok()).toBeTruthy();
  const columns: any[] = await columnsRes.json();

  // Default board has [To Do (open), In Progress (in_progress), In Review (review), Done (closed)]
  const openColumn = columns.find((c: any) => c.state === 'open') || columns[0];
  const closedColumn = columns.find((c: any) => c.state === 'closed') || columns[columns.length - 1];

  const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Team', designator: 'TM-' },
  });
  expect(swimlaneRes.ok(), `createSwimlane failed: ${await swimlaneRes.text()}`).toBeTruthy();
  const swimlaneId: number = (await swimlaneRes.json()).id;

  // Inject token before the page loads
  await page.addInitScript((t) => localStorage.setItem('token', t), token);

  return { token, boardId, columnId: openColumn.id, closedColumnId: closedColumn.id, swimlaneId };
}

/**
 * Create a card and optionally set a due_date via PUT.
 *
 * Pass null for dueDateYMD to create a card with no due date.
 */
async function createCardWithDueDate(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title: string,
  dueDateYMD: string | null,
): Promise<{ id: number; title: string }> {
  const createRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!createRes.ok()) {
    test.skip(true, `Card creation unavailable: ${await createRes.text()}`);
    return { id: 0, title };
  }
  const card = await createRes.json();

  if (dueDateYMD !== null) {
    const updateRes = await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: card.description || '',
        priority: card.priority || 'medium',
        due_date: dueDateYMD,
      },
    });
    expect(updateRes.ok(), `setDueDate failed: ${await updateRes.text()}`).toBeTruthy();
  }

  return { id: card.id, title: card.title };
}

/** Return a YYYY-MM-DD string for a Date. */
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Navigate to board, switch to "All Cards" view, wait for expectedCount cards. */
async function gotoBoardAllCards(
  page: import('@playwright/test').Page,
  boardId: number,
  expectedCount: number,
) {
  await page.goto(`/boards/${boardId}`);
  await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
  await page.locator('.view-btn', { hasText: /All Cards/i }).click();
  await expect(page.locator('.card-item')).toHaveCount(expectedCount, { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// 1. Overdue badge visible on board card
// ---------------------------------------------------------------------------
test('overdue card shows .card-due-date.overdue badge with "Overdue" text on board', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'badge');
  await createCardWithDueDate(request, token, boardId, columnId, swimlaneId, 'Overdue Card', '2020-01-01');

  await gotoBoardAllCards(page, boardId, 1);

  const dueBadge = page.locator('.card-item .card-due-date.overdue');
  await expect(dueBadge).toBeVisible({ timeout: 8000 });
  await expect(dueBadge).toContainText('Overdue');
});

// ---------------------------------------------------------------------------
// 2. Overdue indicator in card modal
// ---------------------------------------------------------------------------
test('opening overdue card modal shows .card-due.overdue indicator in meta', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'modal');
  await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Overdue Modal Card', '2018-06-15',
  );

  await gotoBoardAllCards(page, boardId, 1);

  await page.locator('.card-item').first().click();
  await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

  const modalDue = page.locator('.card-detail-modal-unified .card-due.overdue');
  await expect(modalDue).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// 3. Future due date shows no overdue indicator
// ---------------------------------------------------------------------------
test('card with future due date has a due badge but no overdue class', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'future');
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Future Card', toYMD(futureDate),
  );

  await gotoBoardAllCards(page, boardId, 1);

  // Due date badge should exist but must NOT have overdue class
  await expect(page.locator('.card-item .card-due-date')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.card-item .card-due-date.overdue')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 4. No due date shows no overdue indicator
// ---------------------------------------------------------------------------
test('card with no due date shows no .card-due-date badge at all', async ({ request, page }) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'nodate');

  const createRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'No Due Date Card',
      column_id: columnId,
      swimlane_id: swimlaneId,
      board_id: boardId,
    },
  });
  if (!createRes.ok()) { test.skip(true, `Card creation unavailable`); return; }

  await gotoBoardAllCards(page, boardId, 1);

  await expect(page.locator('.card-item .card-due-date')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 5. Setting due date via card modal
// ---------------------------------------------------------------------------
test('setting due date via card modal saves and shows badge on board card', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'setdate');

  // Create card without due date
  const createRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Set Date Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!createRes.ok()) { test.skip(true, `Card creation unavailable`); return; }
  const card = await createRes.json();

  await gotoBoardAllCards(page, boardId, 1);

  // No due date badge initially
  await expect(page.locator('.card-item .card-due-date')).toHaveCount(0);

  // Open modal and enter edit mode
  await page.locator('.card-item').first().click();
  await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
  await page.locator('.card-detail-actions button:has-text("Edit")').click();
  await expect(page.locator('.card-detail-edit')).toBeVisible({ timeout: 5000 });

  // Set a past due date (overdue)
  await page.locator('.card-detail-edit input[type="date"]').fill('2020-06-15');

  // Save and wait for the PUT response
  const [saveResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/cards/${card.id}`) && r.request().method() === 'PUT',
    ),
    page.locator('.card-detail-actions button:has-text("Save")').click(),
  ]);
  expect(saveResponse.status()).toBe(200);

  // Overdue badge should now appear in modal
  await expect(page.locator('.card-detail-modal-unified .card-due.overdue')).toBeVisible({ timeout: 8000 });

  // Close modal — board card should also show overdue badge
  await page.locator('.modal-close-btn').click();
  await expect(page.locator('.card-item .card-due-date.overdue')).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// 6. Due date format displayed correctly
// ---------------------------------------------------------------------------
test('due date format: past date shows "Overdue", future 1-7 days shows days, far future shows month/day', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'format');

  // Overdue card
  await createCardWithDueDate(request, token, boardId, columnId, swimlaneId, 'Past Card', '2020-03-01');

  // 3-days-from-now card
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 3);
  await createCardWithDueDate(request, token, boardId, columnId, swimlaneId, 'Soon Card', toYMD(soonDate));

  // 30-days-from-now card
  const farDate = new Date();
  farDate.setDate(farDate.getDate() + 30);
  await createCardWithDueDate(request, token, boardId, columnId, swimlaneId, 'Far Card', toYMD(farDate));

  await gotoBoardAllCards(page, boardId, 3);

  // Past card shows "Overdue"
  const pastCard = page.locator('.card-item[aria-label="Past Card"]');
  await expect(pastCard.locator('.card-due-date')).toContainText('Overdue', { timeout: 8000 });

  // Soon card shows "3d" (days)
  const soonCard = page.locator('.card-item[aria-label="Soon Card"]');
  await expect(soonCard.locator('.card-due-date')).toContainText('3d', { timeout: 8000 });

  // Far card shows a month/day format (e.g. "Apr 23")
  const farCard = page.locator('.card-item[aria-label="Far Card"]');
  const farBadge = farCard.locator('.card-due-date');
  await expect(farBadge).toBeVisible({ timeout: 8000 });
  // Should not say "Overdue" or contain just "d" (days) — just date text
  await expect(farBadge).not.toContainText('Overdue');
  await expect(farBadge).not.toContainText('Today');
  await expect(farBadge).not.toContainText('Tomorrow');
});

// ---------------------------------------------------------------------------
// 7. Overdue filter works — only past-due cards shown
// ---------------------------------------------------------------------------
test('overdue filter hides non-overdue cards and shows only overdue cards', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'filter');

  await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Past Due Card', '2020-06-01',
  );
  const future = new Date();
  future.setDate(future.getDate() + 30);
  await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Future Card', toYMD(future),
  );

  await gotoBoardAllCards(page, boardId, 2);

  // Open the filter panel
  await page.locator('.filter-toggle-btn').click();
  await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 6000 });

  // Activate the overdue filter
  const overdueBtn = page.locator('.filter-overdue');
  await expect(overdueBtn).toBeVisible();
  await overdueBtn.click();

  // Only the overdue card remains
  await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Past Due Card');
});

// ---------------------------------------------------------------------------
// 8. Overdue filter excludes no-due-date cards
// ---------------------------------------------------------------------------
test('overdue filter hides cards without any due date', async ({ request, page }) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'filternodate');

  await createCardWithDueDate(request, token, boardId, columnId, swimlaneId, 'Past Due Card', '2019-01-01');

  const noDateRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'No Date Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  if (!noDateRes.ok()) { test.skip(true, `Card creation unavailable`); return; }

  await gotoBoardAllCards(page, boardId, 2);

  await page.locator('.filter-toggle-btn').click();
  await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 6000 });
  await page.locator('.filter-overdue').click();

  // Only the past-due card remains; no-date card is hidden
  await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Past Due Card');
});

// ---------------------------------------------------------------------------
// 9. Card in "Done" (closed) column still shows overdue badge in All Cards view
//    — CardItem does not suppress the badge based on column state
// ---------------------------------------------------------------------------
test('card in Done column still shows overdue badge in All Cards view', async ({
  request,
  page,
}) => {
  const { token, boardId, closedColumnId, swimlaneId } = await setupBoard(request, page, 'done');

  // Create card directly in the closed (Done) column with a past due date
  const createRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Done Overdue Card',
      column_id: closedColumnId,
      swimlane_id: swimlaneId,
      board_id: boardId,
    },
  });
  if (!createRes.ok()) { test.skip(true, `Card creation unavailable`); return; }
  const card = await createRes.json();

  // Set overdue due date
  await request.put(`${BASE}/api/cards/${card.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: card.title, description: '', priority: 'medium', due_date: '2020-01-01' },
  });

  await gotoBoardAllCards(page, boardId, 1);

  // Badge is shown even in a closed column
  const dueBadge = page.locator('.card-item .card-due-date.overdue');
  await expect(dueBadge).toBeVisible({ timeout: 8000 });
  await expect(dueBadge).toContainText('Overdue');
});

// ---------------------------------------------------------------------------
// 10. Overdue card opened from backlog view shows indicator in modal
// ---------------------------------------------------------------------------
test('overdue card opened from backlog view shows overdue indicator in modal', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'backlog');
  await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Backlog Overdue Card', '2019-03-10',
  );

  await page.goto(`/boards/${boardId}`);
  await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

  // Switch to Backlog view
  await page.locator('.view-btn', { hasText: /Backlog/i }).click();
  await expect(page.locator('.backlog-card')).toHaveCount(1, { timeout: 10000 });

  // Open card modal from backlog
  await page.locator('.backlog-card').first().click();
  await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

  // Modal meta should show the overdue indicator
  const modalDue = page.locator('.card-detail-modal-unified .card-due.overdue');
  await expect(modalDue).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// 11. Clearing due date removes overdue indicator
// ---------------------------------------------------------------------------
test('clearing the due date removes the overdue indicator from card and modal', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'clear');
  const card = await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Clear Due Date Card', '2020-01-01',
  );

  await gotoBoardAllCards(page, boardId, 1);

  // Verify overdue badge is visible before clearing
  await expect(page.locator('.card-item .card-due-date.overdue')).toBeVisible({ timeout: 8000 });

  // Open modal and enter edit mode
  await page.locator('.card-item').first().click();
  await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
  await page.locator('.card-detail-actions button:has-text("Edit")').click();
  await expect(page.locator('.card-detail-edit')).toBeVisible({ timeout: 5000 });

  // Clear the due date field
  await page.locator('.card-detail-edit input[type="date"]').fill('');

  // Save and wait for the PUT response
  const [saveResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/cards/${card.id}`) && r.request().method() === 'PUT',
    ),
    page.locator('.card-detail-actions button:has-text("Save")').click(),
  ]);
  expect(saveResponse.status()).toBe(200);

  // Overdue indicator in modal should be gone after save
  await expect(page.locator('.card-detail-modal-unified .card-due.overdue')).toHaveCount(0, {
    timeout: 8000,
  });

  // Close modal and confirm the board card badge is also removed
  await page.locator('.modal-close-btn').click();
  await expect(page.locator('.card-item .card-due-date')).toHaveCount(0, { timeout: 8000 });
});

// ---------------------------------------------------------------------------
// 12. Overdue assigned card shows dashboard-due-overdue badge in My Cards kanban
// ---------------------------------------------------------------------------
test('overdue assigned card shows dashboard-due-overdue badge in My Cards kanban', async ({
  request,
  page,
}) => {
  const email = `test-dash-overdue-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Dash Overdue Tester' },
  });
  expect(signupRes.ok(), `signup failed: ${await signupRes.text()}`).toBeTruthy();
  const token: string = (await signupRes.json()).token;

  const meRes = await request.get(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const userId: number = (await meRes.json()).id;

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Dashboard Overdue Board' },
  });
  const boardId: number = (await boardRes.json()).id;

  const columnsRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columnId: number = (await columnsRes.json())[0].id;

  const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Main', designator: 'M-' },
  });
  const swimlaneId: number = (await swimlaneRes.json()).id;

  const card = await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Overdue Assigned Card', '2021-01-01',
  );

  const assignRes = await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId },
  });
  expect(assignRes.ok(), `assignCard failed: ${await assignRes.text()}`).toBeTruthy();

  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto('/dashboard');
  await page.waitForSelector('.dashboard-kanban', { timeout: 10000 });

  // The due date chip on the kanban card should carry the dashboard-due-overdue class
  const overdueBadge = page.locator('.dashboard-kanban-card-due.dashboard-due-overdue');
  await expect(overdueBadge).toBeVisible({ timeout: 8000 });
  await expect(overdueBadge).toContainText('Overdue');
});

// ---------------------------------------------------------------------------
// 13. Overdue card in active sprint still shows overdue badge on the board
// ---------------------------------------------------------------------------
test('overdue card in active sprint still shows overdue badge on the board', async ({
  request,
  page,
}) => {
  const { token, boardId, columnId, swimlaneId } = await setupBoard(request, page, 'sprint');
  const card = await createCardWithDueDate(
    request, token, boardId, columnId, swimlaneId, 'Sprint Overdue Card', '2020-06-01',
  );

  // Create and start a sprint
  const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Overdue Sprint' },
  });
  expect(sprintRes.ok(), `createSprint failed: ${await sprintRes.text()}`).toBeTruthy();
  const sprintId: number = (await sprintRes.json()).id;

  const startRes = await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(startRes.ok(), `startSprint failed: ${await startRes.text()}`).toBeTruthy();

  // Assign card to the sprint
  const assignRes = await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprintId },
  });
  expect(assignRes.ok(), `assignSprint failed: ${await assignRes.text()}`).toBeTruthy();

  // Navigate to the board — active sprint is the default view
  await page.goto(`/boards/${boardId}`);
  await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

  // Overdue badge must still be present on the sprint card
  const dueBadge = page.locator('.card-item .card-due-date.overdue');
  await expect(dueBadge).toBeVisible({ timeout: 8000 });
  await expect(dueBadge).toContainText('Overdue');
});
