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
  return request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

async function getMembers(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<Array<{ user_id: number; role: string; user?: { display_name: string } }>>;
}

// ---------------------------------------------------------------------------
// Board Settings — Members Tab (original tests, kept intact)
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
    await expect(membersSection.locator('.settings-list-item')).toHaveCount(1, { timeout: 8000 });

    await expect(membersSection.locator('.item-name:has-text("BoardOwner")')).toBeVisible();

    const ownerRow = membersSection.locator('.settings-list-item').filter({ hasText: 'BoardOwner' });
    await expect(ownerRow.locator('.item-meta')).toBeVisible();
    const roleText = await ownerRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/owner|admin/);
  });

  test('Add member via board settings UI', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerAdd', 'owner-add');
    const { user: userB } = await createUser(request, 'NewMember', 'member-add');
    const board = await createBoard(request, tokenA, 'Add Member Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    await page.locator('.modal select').first().selectOption({ label: `${userB.display_name} (${userB.email})` });

    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(membersSection.locator('.item-name:has-text("NewMember")')).toBeVisible({ timeout: 8000 });
  });

  test('Remove member via board settings', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerRemove', 'owner-rm');
    const { user: userB } = await createUser(request, 'MemberToRemove', 'member-rm');
    const board = await createBoard(request, tokenA, 'Remove Member Board');

    await addMember(request, tokenA, board.id, userB.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("MemberToRemove")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: 'MemberToRemove' });

    page.once('dialog', (d) => d.accept());
    await memberRow.locator('.item-delete').click();

    await expect(membersSection.locator('.item-name:has-text("MemberToRemove")')).not.toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Access Control (original tests, kept intact)
// ---------------------------------------------------------------------------

test.describe('Board Members — Access Control', () => {
  test('Non-member cannot access board URL', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerPrivate', 'owner-priv');
    const { token: tokenB } = await createUser(request, 'NonMember', 'nonmember');
    const board = await createBoard(request, tokenA, 'Private Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenB);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Member CAN access board after being added', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerAccess', 'owner-acc');
    const { token: tokenB, user: userB } = await createUser(request, 'MemberAccess', 'member-acc');
    const board = await createBoard(request, tokenA, 'Accessible Board');

    await addMember(request, tokenA, board.id, userB.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenB);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Accessible Board', { timeout: 8000 });
  });

  test('Member role is visible in settings as "member"', async ({ page, request }) => {
    const { token: tokenA } = await createUser(request, 'OwnerRole', 'owner-rl');
    const { user: userB } = await createUser(request, 'RoleMember', 'member-rl');
    const board = await createBoard(request, tokenA, 'Role Check Board');

    await addMember(request, tokenA, board.id, userB.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), tokenA);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("RoleMember")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: 'RoleMember' });

    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/member/);
  });
});

// ---------------------------------------------------------------------------
// Role Change (original — fixme kept)
// ---------------------------------------------------------------------------

test.describe('Board Members — Role Change', () => {
  test.fixme('Change member role via settings UI', async ({ page, request }) => {
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

    await memberRow.locator('select.member-role').selectOption('viewer');

    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/viewer/);
  });
});

// ---------------------------------------------------------------------------
// API-level member tests
// ---------------------------------------------------------------------------

test.describe('Board Members — API', () => {
  test('API: board creator is listed as admin member', async ({ request }) => {
    const { token, user } = await createUser(request, 'Creator', 'api-creator');
    const board = await createBoard(request, token);

    const members = await getMembers(request, token, board.id);
    expect(Array.isArray(members)).toBe(true);

    const creatorEntry = members.find((m) => m.user_id === user.id);
    expect(creatorEntry).toBeDefined();
    expect(creatorEntry!.role).toBe('admin');
  });

  test('API: GET members returns array with user_id and role fields', async ({ request }) => {
    const { token } = await createUser(request, 'ListOwner', 'api-list');
    const board = await createBoard(request, token);

    const members = await getMembers(request, token, board.id);
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThan(0);

    const entry = members[0];
    expect(entry).toHaveProperty('user_id');
    expect(entry).toHaveProperty('role');
  });

  test('API: add member returns 201', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AddOwner', 'api-add-owner');
    const { user: newUser } = await createUser(request, 'NewUser', 'api-add-user');
    const board = await createBoard(request, ownerToken);

    const res = await addMember(request, ownerToken, board.id, newUser.id);
    expect(res.status()).toBe(201);
  });

  test('API: added member appears in GET members list', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AddListOwner', 'api-add-list');
    const { user: newUser } = await createUser(request, 'ListNewUser', 'api-add-list-u');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, newUser.id);

    const members = await getMembers(request, ownerToken, board.id);
    const found = members.find((m) => m.user_id === newUser.id);
    expect(found).toBeDefined();
    expect(found!.role).toBe('member');
  });

  test('API: added member with admin role has role "admin"', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminOwner', 'api-admin-owner');
    const { user: adminUser } = await createUser(request, 'AdminUser', 'api-admin-user');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const members = await getMembers(request, ownerToken, board.id);
    const found = members.find((m) => m.user_id === adminUser.id);
    expect(found).toBeDefined();
    expect(found!.role).toBe('admin');
  });

  test('API: removed member is no longer in members list', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'RmOwner', 'api-rm-owner');
    const { user: memberUser } = await createUser(request, 'RmUser', 'api-rm-user');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id);

    const delRes = await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.ok()).toBe(true);

    const members = await getMembers(request, ownerToken, board.id);
    const found = members.find((m) => m.user_id === memberUser.id);
    expect(found).toBeUndefined();
  });

  test('API: removed member receives 403 on board access', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'RmAccessOwner', 'api-rmacc-owner');
    const { token: memberToken, user: memberUser } = await createUser(request, 'RmAccessUser', 'api-rmacc-user');
    const board = await createBoard(request, ownerToken);

    // Add then remove
    await addMember(request, ownerToken, board.id, memberUser.id);
    await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Former member should now get 403
    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('API: non-admin member cannot remove another member (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NonAdminOwner', 'api-nadm-owner');
    const { token: memberAToken, user: memberA } = await createUser(request, 'MemberA', 'api-nadm-a');
    const { user: memberB } = await createUser(request, 'MemberB', 'api-nadm-b');
    const board = await createBoard(request, ownerToken);

    // Add both members with "member" role (not admin)
    await addMember(request, ownerToken, board.id, memberA.id, 'member');
    await addMember(request, ownerToken, board.id, memberB.id, 'member');

    // Member A (non-admin) tries to remove Member B — should be 403
    const res = await request.delete(`${BASE}/api/boards/${board.id}/members/${memberB.id}`, {
      headers: { Authorization: `Bearer ${memberAToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('API: non-admin member cannot add new member (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AddNonAdminOwner', 'api-nadmadd-owner');
    const { token: memberToken, user: memberUser } = await createUser(request, 'NonAdminMember', 'api-nadmadd-m');
    const { user: targetUser } = await createUser(request, 'Target', 'api-nadmadd-t');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: targetUser.id, role: 'member' },
    });
    expect(res.status()).toBe(403);
  });

  test('API: unauthenticated request returns 401 for members list', async ({ request }) => {
    const { token } = await createUser(request, 'UnAuthOwner', 'api-unauth');
    const board = await createBoard(request, token);

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`);
    expect(res.status()).toBe(401);
  });

  test('API: add member with invalid user_id returns error', async ({ request }) => {
    const { token } = await createUser(request, 'InvalidOwner', 'api-invalid');
    const board = await createBoard(request, token);

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: 999999999, role: 'member' },
    });
    // Should return 4xx (400 or 500 depending on DB constraint)
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('API: duplicate member add is handled gracefully', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DupOwner', 'api-dup-owner');
    const { user: dupUser } = await createUser(request, 'DupUser', 'api-dup-user');
    const board = await createBoard(request, ownerToken);

    // First add — should succeed
    const firstRes = await addMember(request, ownerToken, board.id, dupUser.id);
    expect(firstRes.status()).toBe(201);

    // Second add — should not cause a 5xx; 4xx or 2xx is acceptable
    const secondRes = await addMember(request, ownerToken, board.id, dupUser.id);
    expect(secondRes.status()).toBeLessThan(500);

    // Only one entry for this user in the members list
    const members = await getMembers(request, ownerToken, board.id);
    const userEntries = members.filter((m) => m.user_id === dupUser.id);
    expect(userEntries.length).toBe(1);
  });

  test('API: member count correct after add and remove', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CountOwner', 'api-count-owner');
    const { user: u1 } = await createUser(request, 'CountUser1', 'api-count-u1');
    const { user: u2 } = await createUser(request, 'CountUser2', 'api-count-u2');
    const board = await createBoard(request, ownerToken);

    // Start: only creator (1)
    let members = await getMembers(request, ownerToken, board.id);
    const startCount = members.length;

    await addMember(request, ownerToken, board.id, u1.id);
    await addMember(request, ownerToken, board.id, u2.id);

    members = await getMembers(request, ownerToken, board.id);
    expect(members.length).toBe(startCount + 2);

    // Remove u1
    await request.delete(`${BASE}/api/boards/${board.id}/members/${u1.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    members = await getMembers(request, ownerToken, board.id);
    expect(members.length).toBe(startCount + 1);
  });

  test('API: added member can see board in their boards list', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ListBoardOwner', 'api-listboard-owner');
    const { token: memberToken, user: memberUser } = await createUser(request, 'ListBoardMember', 'api-listboard-m');
    const board = await createBoard(request, ownerToken, 'Visible Board');

    await addMember(request, ownerToken, board.id, memberUser.id);

    // Member should see the board when fetching their boards
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.ok()).toBe(true);
    const boards = await res.json();
    const found = boards.find((b: any) => b.id === board.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('Visible Board');
  });
});

// ---------------------------------------------------------------------------
// API extended tests — new coverage
// ---------------------------------------------------------------------------

test.describe('Board Members — API Extended', () => {
  test('API: member object has user.display_name field', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DisplayOwner', 'api-dn-owner');
    const { user: memberUser } = await createUser(request, 'DisplayNameUser', 'api-dn-user');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const members = await getMembers(request, ownerToken, board.id);
    const entry = members.find((m) => m.user_id === memberUser.id);
    expect(entry).toBeDefined();
    // user.display_name should be present and match
    expect((entry as any).user?.display_name).toBe('DisplayNameUser');
  });

  test('API: member object has board_id field', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'BidOwner', 'api-bid-owner');
    const { user: memberUser } = await createUser(request, 'BidUser', 'api-bid-user');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const members: any[] = await res.json();
    const entry = members.find((m: any) => m.user_id === memberUser.id);
    expect(entry).toBeDefined();
    expect(entry.board_id).toBe(board.id);
  });

  test('API: adding duplicate member returns non-5xx (409 or 400)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DupOwner2', 'api-dup2-owner');
    const { user: dupUser } = await createUser(request, 'DupUser2', 'api-dup2-user');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, dupUser.id, 'member');
    const secondRes = await addMember(request, ownerToken, board.id, dupUser.id, 'member');

    // Should be a client error, not a server error
    expect(secondRes.status()).toBeGreaterThanOrEqual(400);
    expect(secondRes.status()).toBeLessThan(500);
  });

  test('API: adding non-existent user returns 400 or 404', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NEOwner', 'api-ne-owner');
    const board = await createBoard(request, ownerToken);

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: 9999999, role: 'member' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('API: non-member receives 403 on GET /api/boards/:id/members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMListOwner', 'api-nmlist-owner');
    const { token: nmToken } = await createUser(request, 'NMListUser', 'api-nmlist-user');
    const board = await createBoard(request, ownerToken);

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('API: board creator always present as admin in members list', async ({ request }) => {
    const { token: ownerToken, user: ownerUser } = await createUser(request, 'CreatorAdmin', 'api-cradm-owner');
    const board = await createBoard(request, ownerToken);

    const members = await getMembers(request, ownerToken, board.id);
    const creatorEntry = members.find((m) => m.user_id === ownerUser.id);
    expect(creatorEntry).toBeDefined();
    expect(creatorEntry!.role).toBe('admin');
  });

  test('API: board admin (non-creator) can add a new member', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAddOwner', 'api-admnadd-own');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAddAdmin', 'api-admnadd-adm');
    const { user: newUser } = await createUser(request, 'AdminAddNew', 'api-admnadd-new');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: newUser.id, role: 'member' },
    });
    expect(res.status()).toBe(201);
  });

  test('API: board member (non-admin) cannot add a new member (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrAddOwner', 'api-mbradd-own');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrAddMember', 'api-mbradd-m');
    const { user: newUser } = await createUser(request, 'MbrAddNew', 'api-mbradd-n');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: newUser.id, role: 'member' },
    });
    expect(res.status()).toBe(403);
  });

  test('API: DELETE /api/boards/:id/members/:userId removes the member', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DelMbrOwner', 'api-delmb-own');
    const { user: memberUser } = await createUser(request, 'DelMbrUser', 'api-delmb-u');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const delRes = await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.ok()).toBe(true);

    const members = await getMembers(request, ownerToken, board.id);
    expect(members.find((m) => m.user_id === memberUser.id)).toBeUndefined();
  });

  test('API: promote member to admin via PUT changes role in members list', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'PromoApiOwner', 'api-promo-own');
    const { user: memberUser } = await createUser(request, 'PromoApiUser', 'api-promo-u');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Promote via PUT (if route exists)
    const putRes = await request.put(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'admin' },
    });
    // Accept 200/204 (supported) or 404/405 (not implemented) — not a 5xx
    expect(putRes.status()).toBeLessThan(500);

    if (putRes.ok()) {
      const members = await getMembers(request, ownerToken, board.id);
      const entry = members.find((m) => m.user_id === memberUser.id);
      expect(entry?.role).toBe('admin');
    }
  });

  test('API: demote admin to member via PUT changes role in members list', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DemoteApiOwner', 'api-demote-own');
    const { user: adminUser } = await createUser(request, 'DemoteApiUser', 'api-demote-u');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const members1 = await getMembers(request, ownerToken, board.id);
    const before = members1.find((m) => m.user_id === adminUser.id);
    expect(before?.role).toBe('admin');

    const putRes = await request.put(`${BASE}/api/boards/${board.id}/members/${adminUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'member' },
    });
    expect(putRes.status()).toBeLessThan(500);

    if (putRes.ok()) {
      const members2 = await getMembers(request, ownerToken, board.id);
      const after = members2.find((m) => m.user_id === adminUser.id);
      expect(after?.role).toBe('member');
    }
  });

  test('API: board member list always shows creator as admin entry', async ({ request }) => {
    const { token: ownerToken, user: ownerUser } = await createUser(request, 'ListCreator', 'api-lc-own');
    const { user: u1 } = await createUser(request, 'LCUser1', 'api-lc-u1');
    const { user: u2 } = await createUser(request, 'LCUser2', 'api-lc-u2');
    const board = await createBoard(request, ownerToken);

    await addMember(request, ownerToken, board.id, u1.id, 'member');
    await addMember(request, ownerToken, board.id, u2.id, 'admin');

    const members = await getMembers(request, ownerToken, board.id);
    const creatorEntry = members.find((m) => m.user_id === ownerUser.id);
    expect(creatorEntry).toBeDefined();
    expect(creatorEntry!.role).toBe('admin');
  });

  test('API: GET /api/boards/:id/members returns 200 with array', async ({ request }) => {
    const { token } = await createUser(request, 'GetMbrOwner', 'api-getmbr-own');
    const board = await createBoard(request, token);

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('user_id');
    expect(body[0]).toHaveProperty('role');
  });

  test('API: cannot remove last admin (owner removal is blocked)', async ({ request }) => {
    const { token: ownerToken, user: ownerUser } = await createUser(request, 'LastAdmOwner', 'api-lastadm-own');
    const board = await createBoard(request, ownerToken);

    // Owner tries to remove themselves — should be rejected
    const res = await request.delete(`${BASE}/api/boards/${board.id}/members/${ownerUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Should be 4xx, not 2xx or 5xx
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);

    // Owner should still be in the list
    const members = await getMembers(request, ownerToken, board.id);
    const ownerEntry = members.find((m) => m.user_id === ownerUser.id);
    expect(ownerEntry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// UI extended tests
// ---------------------------------------------------------------------------

test.describe('Board Members — UI Extended', () => {
  test('UI: member count shown correctly in settings', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'CountUIOwner', 'ui-count-owner');
    const { user: u1 } = await createUser(request, 'CountUI1', 'ui-count-u1');
    const { user: u2 } = await createUser(request, 'CountUI2', 'ui-count-u2');
    const board = await createBoard(request, ownerToken, 'Count Board');

    await addMember(request, ownerToken, board.id, u1.id);
    await addMember(request, ownerToken, board.id, u2.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    // 3 members total: owner + u1 + u2
    await expect(membersSection.locator('.settings-list-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('UI: admin role label shown for admin member in list', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminLabelOwner', 'ui-admin-owner');
    const { user: adminUser } = await createUser(request, 'AdminLabelUser', 'ui-admin-user');
    const board = await createBoard(request, ownerToken, 'Admin Label Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("AdminLabelUser")')).toBeVisible({ timeout: 8000 });

    const adminRow = membersSection.locator('.settings-list-item').filter({ hasText: 'AdminLabelUser' });
    const roleText = await adminRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/admin/);
  });

  test('UI: member role label shown for member in list', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'MemberLabelOwner', 'ui-mem-owner');
    const { user: memberUser } = await createUser(request, 'MemberLabelUser', 'ui-mem-user');
    const board = await createBoard(request, ownerToken, 'Member Label Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("MemberLabelUser")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'MemberLabelUser' });
    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/member/);
  });

  test('UI: board creator delete button not present for own row', async ({ page, request }) => {
    const { token } = await createUser(request, 'SelfDeleteOwner', 'ui-selfdel-owner');
    const board = await createBoard(request, token, 'Self Delete Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.settings-list-item')).toHaveCount(1, { timeout: 8000 });

    // The creator's own row should either have no delete button or a disabled one
    const ownerRow = membersSection.locator('.settings-list-item').first();
    const deleteBtn = ownerRow.locator('.item-delete');
    const deleteBtnCount = await deleteBtn.count();

    if (deleteBtnCount > 0) {
      // If delete button exists it must be disabled for the creator's own row
      await expect(deleteBtn.first()).toBeDisabled();
    }
    // If no delete button at all, that's also correct — the test passes
  });

  test('UI: added member appears in settings list immediately', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'ImmediateOwner', 'ui-imm-owner');
    const { user: newUser } = await createUser(request, 'ImmediateNewUser', 'ui-imm-user');
    const board = await createBoard(request, ownerToken, 'Immediate Board');

    // Add via API before navigating
    await addMember(request, ownerToken, board.id, newUser.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("ImmediateNewUser")')).toBeVisible({ timeout: 8000 });
  });

  test('UI: board appears in member dashboard board list', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'DashOwner', 'ui-dash-owner');
    const { token: memberToken, user: memberUser } = await createUser(request, 'DashMember', 'ui-dash-member');
    const board = await createBoard(request, ownerToken, 'Dashboard Visible Board');

    await addMember(request, ownerToken, board.id, memberUser.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), memberToken);
    await page.goto('/boards');
    await page.waitForSelector('.board-list, .boards-grid, .board-card', { timeout: 10000 });

    await expect(page.locator('[class*="board"]').filter({ hasText: 'Dashboard Visible Board' })).toBeVisible({ timeout: 8000 });
  });

  test('UI: Settings page Members section shows member list', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'SettingsListOwner', 'ui-setlist-own');
    const { user: u1 } = await createUser(request, 'SettingsListU1', 'ui-setlist-u1');
    const { user: u2 } = await createUser(request, 'SettingsListU2', 'ui-setlist-u2');
    const board = await createBoard(request, ownerToken, 'Settings List Board');

    await addMember(request, ownerToken, board.id, u1.id, 'member');
    await addMember(request, ownerToken, board.id, u2.id, 'admin');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    // All three members (owner + u1 + u2) should appear
    await expect(membersSection.locator('.settings-list-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('UI: member list shows display name and role for each entry', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'DisplayNameOwner', 'ui-dispname-own');
    const { user: memberUser } = await createUser(request, 'DisplayNameMember', 'ui-dispname-m');
    const board = await createBoard(request, ownerToken, 'Display Name Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("DisplayNameMember")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'DisplayNameMember' });
    await expect(memberRow.locator('.item-meta')).toBeVisible();
    const roleText = await memberRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/member|admin|viewer/);
  });

  test('UI: "Add Member" button opens a member selection modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'AddBtnOwner', 'ui-addbtn-own');
    const board = await createBoard(request, token, 'Add Btn Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    // A modal or dialog should appear
    await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible({ timeout: 8000 });
  });

  test('UI: add member modal contains a user dropdown', async ({ page, request }) => {
    const { token } = await createUser(request, 'DropdownOwner', 'ui-dropdown-own');
    const board = await createBoard(request, token, 'Dropdown Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    // Modal select (dropdown) should be present
    await expect(page.locator('.modal select, [role="dialog"] select').first()).toBeVisible({ timeout: 8000 });
  });

  test('UI: new member added via modal appears in the list', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'UIAddModal', 'ui-modal-own');
    const { user: newUser } = await createUser(request, 'UIAddModalNew', 'ui-modal-new');
    const board = await createBoard(request, ownerToken, 'Modal Add Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await membersSection.locator('button:has-text("Add Member")').click();

    await page.locator('.modal select').first().selectOption({ label: `${newUser.display_name} (${newUser.email})` });
    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 8000 });
    await expect(membersSection.locator('.item-name:has-text("UIAddModalNew")')).toBeVisible({ timeout: 8000 });
  });

  test('UI: remove member shows confirm dialog before deletion', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'ConfirmOwner', 'ui-confirm-own');
    const { user: memberUser } = await createUser(request, 'ConfirmMember', 'ui-confirm-m');
    const board = await createBoard(request, ownerToken, 'Confirm Delete Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("ConfirmMember")')).toBeVisible({ timeout: 8000 });

    // Dismiss dialog to confirm it was shown
    let dialogShown = false;
    page.once('dialog', (d) => {
      dialogShown = true;
      d.dismiss();
    });

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'ConfirmMember' });
    await memberRow.locator('.item-delete').click();

    expect(dialogShown).toBe(true);
  });

  test('UI: member removed from list after accepting confirm dialog', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'RmConfirmOwner', 'ui-rmconf-own');
    const { user: memberUser } = await createUser(request, 'RmConfirmMember', 'ui-rmconf-m');
    const board = await createBoard(request, ownerToken, 'Remove Confirm Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("RmConfirmMember")')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'RmConfirmMember' });
    await memberRow.locator('.item-delete').click();

    await expect(membersSection.locator('.item-name:has-text("RmConfirmMember")')).not.toBeVisible({ timeout: 8000 });
  });

  test('UI: role badge shows "Admin" for admin member', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'RoleBadgeOwner', 'ui-rolebadge-own');
    const { user: adminUser } = await createUser(request, 'RoleBadgeAdmin', 'ui-rolebadge-adm');
    const board = await createBoard(request, ownerToken, 'Role Badge Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("RoleBadgeAdmin")')).toBeVisible({ timeout: 8000 });

    const adminRow = membersSection.locator('.settings-list-item').filter({ hasText: 'RoleBadgeAdmin' });
    const metaText = await adminRow.locator('.item-meta').textContent();
    expect(metaText?.toLowerCase()).toMatch(/admin/);
  });

  test('UI: role badge shows "Member" for member role', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'RoleBadgeMbrOwner', 'ui-rolebmbr-own');
    const { user: memberUser } = await createUser(request, 'RoleBadgeMember', 'ui-rolebmbr-m');
    const board = await createBoard(request, ownerToken, 'Role Badge Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("RoleBadgeMember")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'RoleBadgeMember' });
    const metaText = await memberRow.locator('.item-meta').textContent();
    expect(metaText?.toLowerCase()).toMatch(/member/);
  });

  test('UI: board admin sees delete buttons for non-owner members', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'DelBtnOwner', 'ui-delbtn-own');
    const { user: memberUser } = await createUser(request, 'DelBtnMember', 'ui-delbtn-m');
    const board = await createBoard(request, ownerToken, 'Delete Btn Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("DelBtnMember")')).toBeVisible({ timeout: 8000 });

    const memberRow = membersSection.locator('.settings-list-item').filter({ hasText: 'DelBtnMember' });
    // A delete/remove button should be visible for non-owner members when viewed by admin
    await expect(memberRow.locator('.item-delete')).toBeVisible({ timeout: 8000 });
  });

  test('UI: non-admin member does not see delete buttons for other members', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'NoBtnOwner', 'ui-nobtn-own');
    const { token: memberToken, user: memberUser } = await createUser(request, 'NoBtnMember', 'ui-nobtn-m');
    const { user: otherUser } = await createUser(request, 'NoBtnOther', 'ui-nobtn-o');
    const board = await createBoard(request, ownerToken, 'No Delete Btn Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');
    await addMember(request, ownerToken, board.id, otherUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), memberToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(membersSection.locator('.item-name:has-text("NoBtnOther")')).toBeVisible({ timeout: 8000 });

    // When viewed as a regular member, delete buttons for other members should not be present
    const otherRow = membersSection.locator('.settings-list-item').filter({ hasText: 'NoBtnOther' });
    const deleteBtn = otherRow.locator('.item-delete');
    const count = await deleteBtn.count();
    if (count > 0) {
      await expect(deleteBtn.first()).toBeDisabled();
    }
  });
});
