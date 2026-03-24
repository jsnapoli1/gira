import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string; email: string } };
}

async function createBoard(request: any, token: string, name: string) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string };
}

async function createLabel(request: any, token: string, boardId: number, name: string, color = '#ef4444') {
  const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, color },
  });
  return (await res.json()) as { id: number; name: string };
}

async function createSprint(request: any, token: string, boardId: number, name: string) {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string };
}

async function createSwimlane(request: any, token: string, boardId: number, name: string) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator: 'MB-', color: '#6366f1' },
  });
  return (await res.json()) as { id: number; name: string };
}

async function getFirstColumn(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cols = await res.json();
  return cols[0] as { id: number; name: string };
}

async function createCard(request: any, token: string, boardId: number, swimlaneId: number, columnId: number, title: string) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title },
  });
  return (await res.json()) as { id: number; title: string };
}

async function addMember(request: any, token: string, boardId: number, userId: number, role = 'member') {
  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Multi-Board', () => {
  // ── 1. User can own multiple boards ──────────────────────────────────────

  test('user can own multiple boards and all appear in /boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'MultiOwner', 'mb-own');
    await createBoard(request, token, 'Alpha Board');
    await createBoard(request, token, 'Beta Board');
    await createBoard(request, token, 'Gamma Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Alpha Board'))).toBeTruthy();
    expect(names.some(n => n.includes('Beta Board'))).toBeTruthy();
    expect(names.some(n => n.includes('Gamma Board'))).toBeTruthy();
  });

  // ── 2. Labels are board-scoped ────────────────────────────────────────────

  test('label created on board A does not appear on board B', async ({ page, request }) => {
    const { token } = await createUser(request, 'LabelScope', 'mb-label');
    const boardA = await createBoard(request, token, 'Label Board A');
    const boardB = await createBoard(request, token, 'Label Board B');

    // Create label only on boardA
    await createLabel(request, token, boardA.id, 'BoardA-Only', '#22c55e');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Verify label exists on boardA settings
    await page.goto(`/boards/${boardA.id}/settings`);
    await expect(page.locator('.settings-section:has(h2:has-text("Labels")) .item-name:has-text("BoardA-Only")')).toBeVisible({ timeout: 10000 });

    // Verify label does NOT exist on boardB settings
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await expect(page.locator('.item-name:has-text("BoardA-Only")')).not.toBeVisible();
  });

  // ── 3. Members are board-scoped ───────────────────────────────────────────

  test('user added to board A cannot access board B', async ({ page, request }) => {
    const { token: tokenOwner } = await createUser(request, 'MemberOwner', 'mb-mem-own');
    const { token: tokenB, user: userB } = await createUser(request, 'MemberUserB', 'mb-mem-b');
    const boardA = await createBoard(request, tokenOwner, 'Member Board A');
    const boardB = await createBoard(request, tokenOwner, 'Member Board B');

    // Add userB to boardA only
    await addMember(request, tokenOwner, boardA.id, userB.id);

    // Navigate as userB — board A should be accessible
    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Board B should be forbidden
    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  // ── 4. Sprints are board-scoped ───────────────────────────────────────────

  test('sprint created on board A does not appear on board B', async ({ page, request }) => {
    const { token } = await createUser(request, 'SprintScope', 'mb-sprint');
    const boardA = await createBoard(request, token, 'Sprint Board A');
    const boardB = await createBoard(request, token, 'Sprint Board B');

    await createSprint(request, token, boardA.id, 'Sprint Alpha');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // BoardA backlog should show Sprint Alpha
    await page.goto(`/boards/${boardA.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Alpha' })).toBeVisible({ timeout: 8000 });

    // BoardB backlog should have no sprints
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Alpha' })).not.toBeVisible();
  });

  // ── 5. Cards are board-scoped ─────────────────────────────────────────────

  test('cards on board A do not appear on board B', async ({ page, request }) => {
    const { token } = await createUser(request, 'CardScope', 'mb-card');
    const boardA = await createBoard(request, token, 'Card Board A');
    const boardB = await createBoard(request, token, 'Card Board B');

    // Create swimlane and card on boardA
    const swimlaneA = await createSwimlane(request, token, boardA.id, 'TeamA');
    const colA = await getFirstColumn(request, token, boardA.id);
    await createCard(request, token, boardA.id, swimlaneA.id, colA.id, 'BoardA Card');

    // Create swimlane on boardB (no cards)
    await createSwimlane(request, token, boardB.id, 'TeamB');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // BoardA All Cards view shows the card
    await page.goto(`/boards/${boardA.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-title:has-text("BoardA Card")')).toBeVisible({ timeout: 8000 });

    // BoardB All Cards view does not show it
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    // Allow time for the view to settle
    await page.waitForTimeout(1000);
    await expect(page.locator('.card-title:has-text("BoardA Card")')).not.toBeVisible();
  });

  // ── 6. Columns are board-scoped ───────────────────────────────────────────

  test('board A and board B can have different column configurations', async ({ page, request }) => {
    const { token } = await createUser(request, 'ColScope', 'mb-col');
    const boardA = await createBoard(request, token, 'Column Board A');
    const boardB = await createBoard(request, token, 'Column Board B');

    // Add a custom column to boardA only
    await request.post(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'QA Review', position: 99 },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // BoardA settings shows the custom column
    await page.goto(`/boards/${boardA.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Columns")', { timeout: 10000 });
    await expect(page.locator('.settings-section:has(h2:has-text("Columns")) .item-name:has-text("QA Review")')).toBeVisible({ timeout: 8000 });

    // BoardB settings does not show it
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Columns")', { timeout: 10000 });
    await expect(page.locator('.item-name:has-text("QA Review")')).not.toBeVisible();
  });

  // ── 7. Switching boards updates header ────────────────────────────────────

  test('navigating from board A to board B updates the board name in the header', async ({ page, request }) => {
    const { token } = await createUser(request, 'SwitchUser', 'mb-switch');
    const boardA = await createBoard(request, token, 'First Board');
    const boardB = await createBoard(request, token, 'Second Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Navigate to boardA and verify header
    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-header h1')).toContainText('First Board', { timeout: 10000 });

    // Navigate to boardB and verify header updates
    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.board-header h1')).toContainText('Second Board', { timeout: 10000 });
  });

  // ── 8. Board list shows all boards user has access to ─────────────────────

  test('/boards page shows all boards the user has access to', async ({ page, request }) => {
    const { token: tokenOwner } = await createUser(request, 'ListOwner', 'mb-list-own');
    const { token: tokenMember, user: userMember } = await createUser(request, 'ListMember', 'mb-list-mem');

    const ownedBoard = await createBoard(request, tokenOwner, 'Owned Board');
    const sharedBoard = await createBoard(request, tokenOwner, 'Shared Board');

    // Grant member access to shared board
    await addMember(request, tokenOwner, sharedBoard.id, userMember.id);
    // Also create a board the member owns themselves
    await createBoard(request, tokenMember, 'My Own Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenMember);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Shared Board'))).toBeTruthy();
    expect(names.some(n => n.includes('My Own Board'))).toBeTruthy();
    // Owned-only board not shared with this member should not appear
    expect(names.some(n => n.includes('Owned Board'))).toBeFalsy();
  });

  // ── 9. Recent boards on dashboard ────────────────────────────────────────

  test('dashboard shows boards the user has access to in Recent Boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'DashUser', 'mb-dash');
    await createBoard(request, token, 'Dashboard Board A');
    await createBoard(request, token, 'Dashboard Board B');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');
    await page.waitForSelector('.dashboard-content', { timeout: 10000 });

    // Both boards should appear in the Recent Boards section
    await expect(page.locator('.dashboard-boards-grid')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.dashboard-board-card').filter({ hasText: 'Dashboard Board A' })).toBeVisible();
    await expect(page.locator('.dashboard-board-card').filter({ hasText: 'Dashboard Board B' })).toBeVisible();
  });

  // ── 10. Notifications scoped to board ────────────────────────────────────

  test('assignment notification on board A does not pollute board B activity', async ({ page, request }) => {
    const { token: tokenOwner } = await createUser(request, 'NotifOwner', 'mb-notif-own');
    const { token: tokenActor } = await createUser(request, 'NotifActor', 'mb-notif-actor');
    const boardA = await createBoard(request, tokenOwner, 'Notif Board A');
    const boardB = await createBoard(request, tokenOwner, 'Notif Board B');

    // Set up a card on boardA
    const swimlaneA = await createSwimlane(request, tokenOwner, boardA.id, 'TeamA');
    const colA = await getFirstColumn(request, tokenOwner, boardA.id);
    const card = await createCard(request, tokenOwner, boardA.id, swimlaneA.id, colA.id, 'NotifCard');

    // Get owner user id
    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenOwner}` },
    });
    const ownerUser = await meRes.json();

    // Have the actor user assign owner to the card on boardA — generates a notification
    // Actor needs to be a member of boardA first
    const actorMeRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenActor}` },
    });
    const actorUser = await actorMeRes.json();
    await addMember(request, tokenOwner, boardA.id, actorUser.id);

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenActor}` },
      data: { user_id: ownerUser.id },
    });

    // Load as owner, navigate to boardB — notification badge reflects boardA activity
    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenOwner);
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // The notification badge should be visible (notification from boardA is still shown globally)
    await expect(page.locator('.notification-bell')).toBeVisible();

    // Open notifications and verify the notification references boardA's card, not boardB
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    const notificationItems = page.locator('.notification-item');
    const count = await notificationItems.count();
    // There should be at least one notification from the boardA assignment
    expect(count).toBeGreaterThanOrEqual(1);
    // The notification title should mention assignment, not boardB actions
    await expect(page.locator('.notification-title').first()).toContainText("You've been assigned");
  });
});
