import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const API = `http://127.0.0.1:${PORT}`;

// Helper: sign up via API and return token + user info
async function signUp(request: any) {
  const email = `assignee-${crypto.randomUUID()}@test.com`;
  // Use unique display name to avoid ambiguous filter options when tests run in parallel
  const displayName = `Tester-${crypto.randomUUID().slice(0, 8)}`;
  const res = await request.post(`${API}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string } };
}

// Helper: create board with swimlane, return board + swimlane + columns
async function createBoard(request: any, token: string) {
  const boardRes = await request.post(`${API}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Assignee Test Board ${crypto.randomUUID().slice(0, 8)}`, description: '' },
  });
  const board = await boardRes.json();

  const colRes = await request.get(`${API}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columns = await colRes.json();

  const slRes = await request.post(`${API}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Test Lane',
      repo_owner: 'test',
      repo_name: 'repo',
      designator: 'AL-',
      color: '#10b981',
    },
  });
  const swimlane = await slRes.json();

  return { board, columns, swimlane };
}

// Helper: create a card
async function createCard(request: any, token: string, boardId: number, swimlaneId: number, columnId: number, title: string) {
  const res = await request.post(`${API}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      title,
      description: '',
      priority: 'medium',
    },
  });
  return res.json();
}

test.describe('Card Assignees', () => {
  test('assign self to card via dropdown and see in assignees list', async ({ page, request }) => {
    const { token, user } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Assignee Card');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Open card modal
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // The assignee section has an "Add assignee..." select
    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });

    // Select the current user (the only option besides the placeholder)
    await addSelect.selectOption({ label: user.display_name });

    // User should now appear in the assignees list
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });
  });

  test('remove assignee from card', async ({ page, request }) => {
    const { token, user } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    const card = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Remove Assignee Card');

    // Pre-assign the user to the card via API
    await request.post(`${API}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Open card modal
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Assignee should be present
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });

    // Click the remove button (X) on the assignee
    await page.locator('.assignee-item .remove-assignee').first().click();

    // Assignee should be gone
    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });
  });

  test('assigned user avatar appears on card chip after closing modal', async ({ page, request }) => {
    const { token, user } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    const card = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Avatar Card');

    // Pre-assign via API
    await request.post(`${API}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Card chip should show the assignee avatar bubble
    const cardAssignees = page.locator('.card-item .card-assignees');
    await expect(cardAssignees).toBeVisible({ timeout: 5000 });

    // The assignee bubble should contain the user's initial or avatar
    const assigneeBubble = cardAssignees.locator('.card-assignee').first();
    await expect(assigneeBubble).toBeVisible();

    // Verify tooltip title contains the user's display name
    await expect(assigneeBubble).toHaveAttribute('title', user.display_name);
  });

  test('filter board by assignee shows only assigned cards', async ({ page, request }) => {
    const { token, user } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Create 3 cards; assign user to only one
    const assignedCard = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Assigned Card');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unassigned Card 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unassigned Card 2');

    await request.post(`${API}/api/cards/${assignedCard.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Expand filters
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 3000 });

    // Select self in assignee filter
    const assigneeFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });
    await expect(assigneeFilter).toBeVisible({ timeout: 3000 });
    await assigneeFilter.selectOption({ label: user.display_name });

    // Only the assigned card should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.card-item')).toContainText('Assigned Card');

    // Clear the filter via the clear button
    await page.click('.clear-filter');

    // All 3 cards should return
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 5000 });
  });
});
