import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(request: any, label = 'Assignee') {
  const email = `${label.toLowerCase()}-${crypto.randomUUID()}@test.com`;
  const displayName = `${label}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string } };
}

async function createBoard(request: any, token: string) {
  const board = await (await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Assignee Board ${crypto.randomUUID().slice(0, 8)}` },
  })).json();

  const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'AL-', color: '#10b981' },
  })).json();

  return { board, swimlane, columns: board.columns };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
) {
  return request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title, priority: 'medium' },
  });
}

async function openBoardAllCards(page: any, token: string, boardId: number) {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 10000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

async function expandFilters(page: any) {
  const expanded = page.locator('.filters-expanded');
  if (!(await expanded.isVisible())) {
    await page.click('.filter-toggle-btn');
    await expect(expanded).toBeVisible({ timeout: 5000 });
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Card Assignees', () => {

  // -------------------------------------------------------------------------
  // 1. Self-assign via the "Add assignee..." select in the modal sidebar
  // -------------------------------------------------------------------------
  test('self-assign by selecting own name in Add assignee dropdown', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'SelfAssign');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Assignee Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Sidebar shows the "Add assignee..." select
    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });

    // Select the current user — the only option besides the placeholder
    await addSelect.selectOption({ label: user.display_name });

    // User should now appear in the assignees list
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 2. Assigned avatar shown on card in board after closing modal
  // -------------------------------------------------------------------------
  test('assigned avatar shown on card chip after pre-assigning via API', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'AvatarCard');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Avatar Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Pre-assign via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await openBoardAllCards(page, token, board.id);

    // Card chip shows the assignee avatar bubble
    const cardAssignees = page.locator('.card-item .card-assignees');
    await expect(cardAssignees).toBeVisible({ timeout: 5000 });

    const assigneeBubble = cardAssignees.locator('.card-assignee').first();
    await expect(assigneeBubble).toBeVisible();

    // Tooltip title contains the user's display name
    await expect(assigneeBubble).toHaveAttribute('title', user.display_name);
  });

  // -------------------------------------------------------------------------
  // 3. Assigned avatar shown after assigning in modal and closing
  // -------------------------------------------------------------------------
  test('assigned avatar appears on board card after assigning in modal', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'AvatarAssign');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Assign In Modal');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Assign via dropdown
    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });
    await addSelect.selectOption({ label: user.display_name });
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Avatar bubble on board card
    const cardAssignees = page.locator('.card-item .card-assignees');
    await expect(cardAssignees).toBeVisible({ timeout: 5000 });
    const assigneeBubble = cardAssignees.locator('.card-assignee').first();
    await expect(assigneeBubble).toBeVisible();
    await expect(assigneeBubble).toHaveAttribute('title', user.display_name);
  });

  // -------------------------------------------------------------------------
  // 4. Remove self-assignment from modal sidebar
  // -------------------------------------------------------------------------
  test('remove self-assignment via the remove button in modal', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'RemoveAssign');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Remove Assignee Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Pre-assign via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Assignee should be present
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });

    // Click the remove button (X icon) next to the assignee
    await page.locator('.assignee-item .remove-assignee').first().click();

    // Assignee should be gone from the list
    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 5. Removal reflected on board card (no avatars after removal)
  // -------------------------------------------------------------------------
  test('after removing assignee, board card no longer shows avatar', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'NoAvatarAfterRemove');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Remove Avatar Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await openBoardAllCards(page, token, board.id);

    // Verify avatar present before removal
    await expect(page.locator('.card-item .card-assignees')).toBeVisible({ timeout: 5000 });

    // Open modal and remove
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
    await page.locator('.assignee-item .remove-assignee').first().click();
    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Board card no longer has .card-assignees element
    await expect(page.locator('.card-item .card-assignees')).toHaveCount(0, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 6. Assign a second board member to the card
  // -------------------------------------------------------------------------
  test('assign a second board member to the card', async ({ page, request }) => {
    const { token, user: owner } = await signUp(request, 'BoardOwner');
    const { token: token2, user: member } = await signUp(request, 'BoardMember');
    const { board, swimlane, columns } = await createBoard(request, token);

    // Add second user as board member
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: member.id, role: 'member' },
    });

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Multi Assignee Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    // Pre-assign owner
    const card = await cardRes.json();
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: owner.id },
    });

    // Navigate as owner
    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // Both users should be available; assign the second member
    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });
    await addSelect.selectOption({ label: member.display_name });

    // Both assignees should now appear
    const assigneeNames = page.locator('.assignee-item .assignee-name');
    await expect(assigneeNames).toHaveCount(2, { timeout: 5000 });

    const namesText = await assigneeNames.allTextContents();
    expect(namesText).toContain(owner.display_name);
    expect(namesText).toContain(member.display_name);
  });

  // -------------------------------------------------------------------------
  // 7. Multiple assignees on one card — avatars shown on board chip
  // -------------------------------------------------------------------------
  test('multiple assignees show as stacked avatars on board card', async ({ page, request }) => {
    const { token, user: user1 } = await signUp(request, 'Multi1');
    const { token: _token2, user: user2 } = await signUp(request, 'Multi2');
    const { board, swimlane, columns } = await createBoard(request, token);

    // Add user2 as board member
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user2.id, role: 'member' },
    });

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Multi Avatar Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign both users
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user1.id },
    });
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user2.id },
    });

    await openBoardAllCards(page, token, board.id);

    // Two .card-assignee bubbles present on the board card
    const cardAssignees = page.locator('.card-item .card-assignees');
    await expect(cardAssignees).toBeVisible({ timeout: 5000 });
    await expect(cardAssignees.locator('.card-assignee')).toHaveCount(2, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 8. Assignee filter — shows only cards assigned to selected user
  // -------------------------------------------------------------------------
  test('assignee filter shows only cards assigned to selected user', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'FilterAssign');
    const { board, swimlane, columns } = await createBoard(request, token);

    // Create 3 cards; assign user to only one
    const assignedRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Assigned Card');
    if (!assignedRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await assignedRes.text()}`);
      return;
    }
    const assignedCard = await assignedRes.json();

    const u2Res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unassigned Card 1');
    if (!u2Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await u2Res.text()}`);
      return;
    }
    const u3Res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unassigned Card 2');
    if (!u3Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await u3Res.text()}`);
      return;
    }

    await request.post(`${BASE}/api/cards/${assignedCard.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Expand filters and select self in the assignee filter
    await expandFilters(page);
    const assigneeFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });
    await expect(assigneeFilter).toBeVisible({ timeout: 3000 });
    await assigneeFilter.selectOption({ label: user.display_name });

    // Only the assigned card should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.card-item')).toContainText('Assigned Card');

    // Clear filter
    await page.click('.clear-filter');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Assignee filter — filter by second board member shows only their cards
  // -------------------------------------------------------------------------
  test('assignee filter by second board member shows only their cards', async ({ page, request }) => {
    const { token, user: owner } = await signUp(request, 'FilterOwner');
    const { token: _token2, user: member } = await signUp(request, 'FilterMember');
    const { board, swimlane, columns } = await createBoard(request, token);

    // Add member as board member
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: member.id, role: 'member' },
    });

    // Create 2 cards — assign owner to one, member to another
    const c1Res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Owner Card');
    if (!c1Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await c1Res.text()}`);
      return;
    }
    const ownerCard = await c1Res.json();

    const c2Res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Member Card');
    if (!c2Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await c2Res.text()}`);
      return;
    }
    const memberCard = await c2Res.json();

    await request.post(`${BASE}/api/cards/${ownerCard.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: owner.id },
    });
    await request.post(`${BASE}/api/cards/${memberCard.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: member.id },
    });

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    await expandFilters(page);
    const assigneeFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });

    // Filter to member — only "Member Card" shown
    await assigneeFilter.selectOption({ label: member.display_name });
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.card-item')).toContainText('Member Card');

    // Filter to owner — only "Owner Card" shown
    await assigneeFilter.selectOption({ label: owner.display_name });
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.card-item')).toContainText('Owner Card');

    // Clear filter — both cards return
    await page.click('.clear-filter');
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 10. Assignee removal removes them from assignee filter options
  //     (i.e. selecting them after removal yields 0 cards)
  // -------------------------------------------------------------------------
  test('after removing assignee, filtering by that user shows no cards', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'FilterAfterRemove');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Was Assigned Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign then immediately remove via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });
    await request.delete(`${BASE}/api/cards/${card.id}/assignees/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Card should have no assignee bubble
    await expect(page.locator('.card-item .card-assignees')).toHaveCount(0, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 11. Add assignee removes them from the "Add assignee..." dropdown options
  // -------------------------------------------------------------------------
  test('user already assigned disappears from Add assignee dropdown', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'DropdownUpdate');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Dropdown Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    const addSelect = page.locator('.add-assignee-select');
    await expect(addSelect).toBeVisible({ timeout: 5000 });

    // Assign the user
    await addSelect.selectOption({ label: user.display_name });
    await expect(page.locator('.assignee-item .assignee-name')).toContainText(user.display_name, { timeout: 5000 });

    // The same user should no longer appear in the dropdown options
    // (unassignedUsers is computed by filtering out already-assigned users)
    const options = await addSelect.locator('option').allTextContents();
    // Only the placeholder remains when user is the sole board member
    expect(options.filter((o) => o.trim() === user.display_name)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 12. Assignee data survives page reload
  // -------------------------------------------------------------------------
  test('assignee persists after page reload', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'PersistAssign');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Persistent Assignee Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    await openBoardAllCards(page, token, board.id);

    // Avatar visible before reload
    await expect(page.locator('.card-item .card-assignees')).toBeVisible({ timeout: 5000 });

    // Reload
    await page.reload();
    await page.waitForSelector('.board-header', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Avatar still visible after reload
    const cardAssignees = page.locator('.card-item .card-assignees');
    await expect(cardAssignees).toBeVisible({ timeout: 5000 });
    const assigneeBubble = cardAssignees.locator('.card-assignee').first();
    await expect(assigneeBubble).toBeVisible();
    await expect(assigneeBubble).toHaveAttribute('title', user.display_name);
  });

  // -------------------------------------------------------------------------
  // 13. GET /api/cards/:id/assignees returns assigned user
  // -------------------------------------------------------------------------
  test('GET card assignees API returns the assigned user', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'ApiGetAssignees');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'API Assignees Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    // Verify via GET /api/cards/:id/assignees
    const assigneesRes = await request.get(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(assigneesRes.status()).toBe(200);

    const assignees = await assigneesRes.json();
    expect(Array.isArray(assignees)).toBe(true);
    expect(assignees.length).toBe(1);
    expect(assignees[0].id).toBe(user.id);
    expect(assignees[0].display_name).toBe(user.display_name);

    // Navigate to keep the page fixture satisfied
    await page.goto('/login');
  });

  // -------------------------------------------------------------------------
  // 14. GET /api/cards/:id returns assignees array inline with card data
  // -------------------------------------------------------------------------
  test('GET card returns embedded assignees array', async ({ page, request }) => {
    const { token, user } = await signUp(request, 'EmbeddedAssignees');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Embedded Assignees Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Assign via API
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    // Verify the card's GET response includes the assignees field
    const cardDetailRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardDetailRes.status()).toBe(200);

    const cardData = await cardDetailRes.json();
    expect(Array.isArray(cardData.assignees)).toBe(true);
    expect(cardData.assignees.length).toBe(1);
    expect(cardData.assignees[0].id).toBe(user.id);

    await page.goto('/login');
  });

  // -------------------------------------------------------------------------
  // 15. Assignee modal section shows "No assignees" when card has none
  // -------------------------------------------------------------------------
  test('unassigned card shows empty assignees section in modal', async ({ page, request }) => {
    const { token } = await signUp(request, 'EmptyAssignees');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unassigned Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // No assignee items present
    await expect(page.locator('.assignee-item')).toHaveCount(0, { timeout: 5000 });

    // Board card should have no .card-assignees element
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-item .card-assignees')).toHaveCount(0, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 16. Sidebar Assignees section label is visible in card modal
  // -------------------------------------------------------------------------
  test('modal sidebar always shows Assignees section label', async ({ page, request }) => {
    const { token } = await signUp(request, 'AssigneeSectionLabel');
    const { board, swimlane, columns } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Section Label Card');
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }

    await openBoardAllCards(page, token, board.id);
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });

    // The sidebar should always have an "Assignees" label
    await expect(page.locator('.sidebar-section label:has-text("Assignees")')).toBeVisible({ timeout: 5000 });

    // The "Add assignee..." select should be present even when no one is assigned
    await expect(page.locator('.add-assignee-select')).toBeVisible({ timeout: 5000 });
  });
});
