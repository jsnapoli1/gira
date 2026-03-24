import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  displayName: string,
  prefix: string,
) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string; email: string } };
}

async function createBoard(request: any, token: string, name = 'Shared Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string };
}

async function addMember(request: any, token: string, boardId: number, userId: number, role = 'member') {
  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

// ---------------------------------------------------------------------------
// Board Settings — Members Tab
// ---------------------------------------------------------------------------

test.describe('Board Members — Settings UI', () => {
  test('Members section is visible in board settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'Owner', 'owner-vis');
    const board = await createBoard(request, token);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-section h2:has-text("Members")')).toBeVisible();
  });

  test('Owner appears in members list with owner role', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardOwner', 'owner-role');
    const board = await createBoard(request, token);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    // Wait for the member list to render
    await expect(membersSection.locator('.settings-list-item')).toHaveCount(1, { timeout: 8000 });

    // The owner's display name should be visible
    await expect(membersSection.locator('.item-name:has-text("BoardOwner")')).toBeVisible();

    // Role shown in .item-meta — the board creator is stored with role "admin" in the DB
    const ownerRow = membersSection.locator('.settings-list-item').filter({ hasText: 'BoardOwner' });
    await expect(ownerRow.locator('.item-meta')).toBeVisible();
    const roleText = await ownerRow.locator('.item-meta').textContent();
    // Accept either "owner" or "admin" — the backend stores the creator as "admin"
    expect(roleText?.toLowerCase()).toMatch(/owner|admin/);
  });

  test('Add member via board settings UI', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerAdd', 'owner-add');
    const { user: userB } = await createUser(request, 'NewMember', 'member-add');
    const board = await createBoard(request, tokenA, 'Add Member Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    // Click "Add Member" button to open modal
    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    // Select User B from the user dropdown
    await page.locator('.modal select').first().selectOption({ label: `${userB.display_name} (${userB.email})` });

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    // Modal should close
    await expect(page.locator('.modal')).not.toBeVisible();

    // User B should now appear in the members list
    await expect(membersSection.locator('.item-name:has-text("NewMember")')).toBeVisible({ timeout: 8000 });
  });

  test('Remove member via board settings', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerRemove', 'owner-rm');
    const { user: userB } = await createUser(request, 'MemberToRemove', 'member-rm');
    const board = await createBoard(request, tokenA, 'Remove Member Board');

    // Pre-add User B via API
    await addMember(request, tokenA, board.id, userB.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    // User B should be in the list
    await expect(membersSection.locator('.item-name:has-text("MemberToRemove")')).toBeVisible({ timeout: 8000 });

    // Click delete on User B's row
    const memberRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: 'MemberToRemove' });

    page.once('dialog', (d) => d.accept());
    await memberRow.locator('.item-delete').click();

    // User B should no longer appear in the list
    await expect(membersSection.locator('.item-name:has-text("MemberToRemove")')).not.toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Access Control
// ---------------------------------------------------------------------------

test.describe('Board Members — Access Control', () => {
  test('Non-member cannot access board URL', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerPrivate', 'owner-priv');
    const { token: tokenB } = await createUser(request, 'NonMember', 'nonmember');
    const board = await createBoard(request, tokenA, 'Private Board');

    // Navigate as User B (not a member)
    await page.addInitScript((t) => localStorage.setItem('token', t), tokenB);
    await page.goto(`/boards/${board.id}`);

    // Board should NOT be accessible — either redirected away or error shown
    // BoardView renders `.error` with "Board not found" when the API returns 403
    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    // The board header (which only appears for members) must not be visible
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Member CAN access board after being added', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerAccess', 'owner-acc');
    const { token: tokenB, user: userB } = await createUser(request, 'MemberAccess', 'member-acc');
    const board = await createBoard(request, tokenA, 'Accessible Board');

    // Add User B as member via API
    await addMember(request, tokenA, board.id, userB.id);

    // Navigate as User B
    await page.addInitScript((t) => localStorage.setItem('token', t), tokenB);
    await page.goto(`/boards/${board.id}`);

    // Board should load — the .board-page wrapper is rendered when board is accessible
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    // Board name should appear in the header
    await expect(page.locator('.board-header h1')).toContainText('Accessible Board', { timeout: 8000 });
  });

  test('Member role is visible in settings as "member"', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerRole', 'owner-rl');
    const { user: userB } = await createUser(request, 'RoleMember', 'member-rl');
    const board = await createBoard(request, tokenA, 'Role Check Board');

    // Add User B with explicit "member" role
    await addMember(request, tokenA, board.id, userB.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    // User B's row should show the role label
    await expect(membersSection.locator('.item-name:has-text("RoleMember")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: 'RoleMember' });

    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/member/);
  });
});

// ---------------------------------------------------------------------------
// Role Change (fixme — no role-change UI in current member list)
// ---------------------------------------------------------------------------

test.describe('Board Members — Role Change', () => {
  test.fixme('Change member role via settings UI', async ({ page, request }) => {
    // The members list in BoardSettings.tsx renders .item-meta for the role but
    // provides no inline dropdown or edit control to change an existing member's
    // role.  Mark fixme until the UI adds that capability.
    const { token: tokenA } = await createUser(request, 'OwnerChange', 'owner-ch');
    const { user: userB } = await createUser(request, 'RoleChange', 'member-ch');
    const board = await createBoard(request, tokenA, 'Role Change Board');

    await addMember(request, tokenA, board.id, userB.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("RoleChange")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: 'RoleChange' });

    // Find role dropdown on the row and change to "viewer"
    await memberRow.locator('select.member-role').selectOption('viewer');

    // Verify role updated
    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/viewer/);
  });
});
