/**
 * Board permissions E2E tests for Zira.
 *
 * Covers every enforced board role: owner (admin), admin member, member, viewer,
 * and non-member. Tests are split between API-level (faster, no browser) and
 * UI-level (full browser navigation) as appropriate.
 *
 * Role hierarchy (from models/models.go):
 *   owner  → BoardRoleAdmin  (board.OwnerID == user.ID)
 *   admin  → BoardRoleAdmin  (explicit board_members row with role = "admin")
 *   member → BoardRoleMember (can create/edit cards, cannot edit board settings)
 *   viewer → BoardRoleViewer (read-only; cannot create cards or edit settings)
 *
 * Known issues:
 *   - POST /api/cards may fail with Gitea 401 when Gitea is unconfigured.
 *     API-level card-creation tests that rely on the Gitea integration are
 *     fixme'd (see the note on each). Tests that call POST /api/cards and
 *     are NOT fixme'd work because the board has a swimlane with
 *     repo_source = "default_gitea" but the permission check happens before
 *     the Gitea call, so a 403 response is reliably returned for forbidden
 *     callers.
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  expect(res.status(), `createUser failed for ${displayName}: ${res.status()}`).toBe(200);
  const body = await res.json();
  return {
    token: body.token as string,
    user: body.user as { id: number; display_name: string; email: string },
  };
}

async function createBoard(request: any, token: string, name = 'Test Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeLessThan(300);
  return (await res.json()) as { id: number; name: string; owner_id: number };
}

async function addMember(
  request: any,
  token: string,
  boardId: number,
  userId: number,
  role = 'member',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
  return res;
}

async function createSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
  });
  expect(res.status(), `createSwimlane failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createSwimlane failed: ${res.status()}`).toBeLessThan(300);
  return res.json();
}

async function getFirstColumn(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const columns = await res.json();
  expect(columns.length).toBeGreaterThan(0);
  return columns[0] as { id: number };
}

// ---------------------------------------------------------------------------
// 1. Board owner has admin role
// ---------------------------------------------------------------------------

test.describe('Board owner has admin role', () => {

  test('Owner can read their own board via GET /api/boards/:id', async ({ request }) => {
    const { token } = await createUser(request, 'OwnerRead', 'perm-owner-read');
    const board = await createBoard(request, token, 'Owner Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(board.id);
  });

  test('Owner can update board settings via PUT /api/boards/:id', async ({ request }) => {
    const { token } = await createUser(request, 'OwnerUpdate', 'perm-owner-update');
    const board = await createBoard(request, token, 'Owner Update Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Owner Renamed Board', description: 'updated' },
    });

    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe('Owner Renamed Board');
  });

  test('Owner can add members to their board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAddMember', 'perm-owner-addmem');
    const { user: userB } = await createUser(request, 'UserToAdd', 'perm-user-add');
    const board = await createBoard(request, ownerToken, 'Owner Add Member Board');

    const res = await addMember(request, ownerToken, board.id, userB.id, 'member');
    // POST /api/boards/:id/members returns 201 Created
    expect(res.status()).toBe(201);
  });

  test('Owner can delete their board via DELETE /api/boards/:id', async ({ request }) => {
    const { token } = await createUser(request, 'OwnerDelete', 'perm-owner-delete');
    const board = await createBoard(request, token, 'Owner Delete Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // DELETE /api/boards/:id returns 204 No Content
    expect(res.status()).toBe(204);
  });

  test('Board owner appears in member list with admin role', async ({ request }) => {
    const { token: ownerToken, user: ownerUser } = await createUser(request, 'OwnerInList', 'perm-owner-list');
    const board = await createBoard(request, ownerToken, 'Owner List Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    expect(res.status()).toBe(200);
    const members = await res.json();
    const ownerEntry = members.find((m: any) => m.user_id === ownerUser.id || m.id === ownerUser.id);
    // Owner is always in the member list with admin role.
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry.role).toBe('admin');
  });

  // UI test: owner sees full settings page with member management controls.
  test('Owner adds a user as member via board settings UI', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAdd', 'perm-owner-add');
    const { user: userB } = await createUser(request, 'NewMemberAdd', 'perm-new-add');
    const board = await createBoard(request, ownerToken, 'Owner Add Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    await page.locator('.modal select').first().selectOption({
      label: `${userB.display_name} (${userB.email})`,
    });

    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).toBeVisible({ timeout: 8000 });
  });

});

// ---------------------------------------------------------------------------
// 2. Admin member role
// ---------------------------------------------------------------------------

test.describe('Board admin member role', () => {

  test('Admin member can rename the board via PUT /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerForAdmin', 'perm-owner-admin');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminMember', 'perm-admin-member');
    const board = await createBoard(request, ownerToken, 'Admin Rename Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Renamed Board', description: '' },
    });

    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe('Admin Renamed Board');
  });

  test('Admin member can add new members to the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAddAdmin', 'perm-owner-addadmin');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAdds', 'perm-admin-adds');
    const { user: thirdUser } = await createUser(request, 'ThirdUserAdmin', 'perm-third-admin');
    const board = await createBoard(request, ownerToken, 'Admin Add Members Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await addMember(request, adminToken, board.id, thirdUser.id, 'viewer');
    // POST /api/boards/:id/members returns 201 Created
    expect(res.status()).toBe(201);
  });

  test('Admin member can remove other members from the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRemAdmin', 'perm-owner-remadmin');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminRemoves', 'perm-admin-removes');
    const { user: targetUser } = await createUser(request, 'TargetAdminRm', 'perm-target-adminrm');
    const board = await createBoard(request, ownerToken, 'Admin Remove Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');
    await addMember(request, ownerToken, board.id, targetUser.id, 'member');

    const res = await request.delete(`${BASE}/api/boards/${board.id}/members/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // DELETE /api/boards/:id/members/:id returns 204 No Content
    expect(res.status()).toBe(204);
  });

  test('Admin role is shown in the member list as "admin"', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRoleAdm', 'perm-owner-roleadm');
    const { user: adminUser } = await createUser(request, 'AdminRoleVis', 'perm-admin-rolevis');
    const board = await createBoard(request, ownerToken, 'Admin Role Visible Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(
      membersSection.locator(`.item-name:has-text("${adminUser.display_name}")`),
    ).toBeVisible({ timeout: 8000 });

    const adminRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: adminUser.display_name });

    const roleText = await adminRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/admin/);
  });

  test('Admin member can rename board via settings UI', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAdmin UI', 'perm-owner-admin-ui');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminMemberUI', 'perm-admin-member-ui');
    const board = await createBoard(request, ownerToken, 'Admin Rename Board UI');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
    await page.goto(`/boards/${board.id}/settings`);

    const nameInput = page.locator('#boardName');
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Admin Renamed Board UI');

    // Wait for the save API call to complete before reloading — click triggers
    // an async boardsApi.update() and a reload before it finishes would discard
    // the change (the save happens client-side, not via a form POST).
    await Promise.all([
      page.waitForResponse((resp) => resp.url().includes(`/api/boards/${board.id}`) && resp.request().method() === 'PUT'),
      page.locator('button:has-text("Save Changes")').click(),
    ]);

    await page.reload();
    await expect(page.locator('#boardName')).toHaveValue('Admin Renamed Board UI');
  });

});

// ---------------------------------------------------------------------------
// 3. Member role
// ---------------------------------------------------------------------------

test.describe('Member role', () => {

  test('Member can read the board via GET /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMemberRead', 'perm-owner-mr');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberRead', 'perm-member-read');
    const board = await createBoard(request, ownerToken, 'Member Read Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Member can read cards on the board via GET /api/boards/:id/cards', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMemberCards', 'perm-owner-mc');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberCards', 'perm-member-cardsread');
    const board = await createBoard(request, ownerToken, 'Member Cards Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Member cannot update board settings via PUT /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMbrSet', 'perm-owner-mbrset');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberSettings', 'perm-member-settings');
    const board = await createBoard(request, ownerToken, 'Member Settings Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Should Fail', description: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member cannot add other users to the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMgrMbr', 'perm-owner-mgr');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberMgr', 'perm-member-mgr');
    const { user: thirdUser } = await createUser(request, 'ThirdUser', 'perm-third');
    const board = await createBoard(request, ownerToken, 'Member Manage Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: thirdUser.id, role: 'member' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member cannot remove another member from the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRmMbr', 'perm-owner-rmmb');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberRm', 'perm-member-rm2');
    const { user: targetUser } = await createUser(request, 'TargetRm', 'perm-target-rm');
    const board = await createBoard(request, ownerToken, 'Member Remove Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');
    await addMember(request, ownerToken, board.id, targetUser.id, 'member');

    const res = await request.delete(
      `${BASE}/api/boards/${board.id}/members/${targetUser.id}`,
      { headers: { Authorization: `Bearer ${memberToken}` } },
    );

    expect(res.status()).toBe(403);
  });

  // Card creation via API is marked fixme because POST /api/cards may fail
  // with Gitea 401 even when the permission check would succeed, when Gitea
  // is not configured in the test environment.
  test.fixme(
    'Member can create a card via POST /api/cards',
    async ({ request }) => {
      const { token: ownerToken } = await createUser(request, 'OwnerMemberCard', 'perm-owner-memcard');
      const { token: memberToken, user: memberUser } = await createUser(request, 'MemberCard', 'perm-member-card');
      const board = await createBoard(request, ownerToken, 'Member Card Board');
      const swimlane = await createSwimlane(request, ownerToken, board.id);
      const column = await getFirstColumn(request, ownerToken, board.id);

      await addMember(request, ownerToken, board.id, memberUser.id, 'member');

      const res = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${memberToken}` },
        data: {
          title: 'Member Created Card',
          board_id: board.id,
          column_id: column.id,
          swimlane_id: swimlane.id,
        },
      });

      expect(res.status()).toBe(201);
    },
  );

  // UI test: member sees the board and the add-card button.
  test('Member can load the board view and see add-card button', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerCards', 'perm-owner-cards');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MemberCards UI', 'perm-member-cards-ui');
    const board = await createBoard(request, ownerToken, 'Member Card Board');

    await createSwimlane(request, ownerToken, board.id);
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), memberToken);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');

    const addBtn = page.locator('.add-card-btn').first();
    await expect(addBtn).toBeVisible({ timeout: 8000 });
  });

});

// ---------------------------------------------------------------------------
// 4. Viewer role (read-only)
// ---------------------------------------------------------------------------

test.describe('Viewer role — read-only access', () => {

  test('Viewer can read the board via GET /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewerRead', 'perm-owner-vread');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerRead', 'perm-viewer-read');
    const board = await createBoard(request, ownerToken, 'Viewer Read Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Viewer GET /api/boards/:id/cards returns 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewCards', 'perm-owner-vc');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerCards2', 'perm-viewer-cards2');
    const board = await createBoard(request, ownerToken, 'Viewer Cards Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Viewer cannot create a card — POST /api/cards returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewer', 'perm-owner-viewer');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerCards', 'perm-viewer-cards');
    const board = await createBoard(request, ownerToken, 'Viewer Card Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    const columns = await columnsRes.json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: {
        title: 'Viewer Should Fail',
        board_id: board.id,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    // Permission check happens before the Gitea call, so 403 is returned
    // regardless of whether Gitea is configured.
    expect(cardRes.status()).toBe(403);
  });

  test('Viewer cannot update board settings — PUT /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewSet', 'perm-owner-vwset');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerSettings', 'perm-viewer-settings');
    const board = await createBoard(request, ownerToken, 'Viewer Settings Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Fail', description: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer cannot add members to the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewAddMem', 'perm-owner-vaddmem');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerAddMem', 'perm-viewer-addmem');
    const { user: thirdUser } = await createUser(request, 'ThirdViewAdd', 'perm-third-vadd');
    const board = await createBoard(request, ownerToken, 'Viewer Add Member Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { user_id: thirdUser.id, role: 'viewer' },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer role is shown in the member list as "viewer"', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRoleVis', 'perm-owner-rolevis');
    const { user: viewerUser } = await createUser(request, 'ViewerRoleVis', 'perm-viewer-rolevis');
    const board = await createBoard(request, ownerToken, 'Role Visible Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(
      membersSection.locator(`.item-name:has-text("${viewerUser.display_name}")`),
    ).toBeVisible({ timeout: 8000 });

    const viewerRow = membersSection
      .locator('.settings-list-item')
      .filter({ hasText: viewerUser.display_name });

    const roleText = await viewerRow.locator('.item-meta').textContent();
    expect(roleText?.toLowerCase()).toMatch(/viewer/);
  });

  test('Viewer can load the board view', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewRead', 'perm-owner-vr');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerRead UI', 'perm-viewer-read-ui');
    const board = await createBoard(request, ownerToken, 'Viewer Read Board UI');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    await page.addInitScript((t) => localStorage.setItem('token', t), viewerToken);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Viewer Read Board UI', {
      timeout: 8000,
    });
  });

});

// ---------------------------------------------------------------------------
// 5. Non-member access denied
// ---------------------------------------------------------------------------

test.describe('Non-member — board access denied', () => {

  test('Non-member GET /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerApi', 'perm-owner-api');
    const { token: nonMemberToken } = await createUser(request, 'NonMemberApi', 'perm-nm-api');
    const board = await createBoard(request, ownerToken, 'Private API Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/cards returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerNMCards', 'perm-owner-nmcards');
    const { token: nonMemberToken } = await createUser(request, 'NonMemberCards', 'perm-nm-cards');
    const board = await createBoard(request, ownerToken, 'NM Cards Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/columns returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerNMCols', 'perm-owner-nmcols');
    const { token: nonMemberToken } = await createUser(request, 'NonMemberCols', 'perm-nm-cols');
    const board = await createBoard(request, ownerToken, 'NM Columns Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member PUT /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerNMEdit', 'perm-owner-nmedit');
    const { token: nonMemberToken } = await createUser(request, 'NonMemberEdit', 'perm-nm-edit');
    const board = await createBoard(request, ownerToken, 'NM Edit Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
      data: { name: 'Hijacked Name', description: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member navigating to board URL sees error, not board content', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerPriv', 'perm-owner-priv');
    const { token: nonMemberToken } = await createUser(request, 'NonMember', 'perm-nonmember');
    const board = await createBoard(request, ownerToken, 'Private Board Perm');

    await page.addInitScript((t) => localStorage.setItem('token', t), nonMemberToken);
    await page.goto(`/boards/${board.id}`);

    // BoardView renders .error when the API returns 403.
    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// 6. Member removal — access revocation
// ---------------------------------------------------------------------------

test.describe('Removed member — loses board access', () => {

  test('Removed member GET /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerApiLose', 'perm-owner-api-lose');
    const { token: removedToken, user: removedUser } = await createUser(request, 'RemovedApi', 'perm-removed-api');
    const board = await createBoard(request, ownerToken, 'API Lose Access Board');

    await addMember(request, ownerToken, board.id, removedUser.id, 'member');
    await request.delete(`${BASE}/api/boards/${board.id}/members/${removedUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${removedToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('After removal, former member cannot load the board in the browser', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerLoseAccess', 'perm-owner-lose');
    const { token: removedToken, user: removedUser } = await createUser(request, 'RemovedMember', 'perm-removed');
    const board = await createBoard(request, ownerToken, 'Lose Access Board');

    await addMember(request, ownerToken, board.id, removedUser.id, 'member');
    await request.delete(`${BASE}/api/boards/${board.id}/members/${removedUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), removedToken);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Owner removes a member from board settings UI', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRemovePerm', 'perm-owner-rm');
    const { user: userB } = await createUser(request, 'MemberToRemovePerm', 'perm-member-rm');
    const board = await createBoard(request, ownerToken, 'Owner Remove Board');

    await addMember(request, ownerToken, board.id, userB.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await membersSection
      .locator('.settings-list-item')
      .filter({ hasText: userB.display_name })
      .locator('.item-delete')
      .click();

    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).not.toBeVisible({ timeout: 8000 });
  });

});

// ---------------------------------------------------------------------------
// 7. Role change — re-add member with different role
// ---------------------------------------------------------------------------

test.describe('Role change', () => {

  test('Owner changes member role from viewer to member via remove + re-add', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRoleChg', 'perm-owner-rchg');
    const { user: userB } = await createUser(request, 'RoleChangeUser', 'perm-role-chg');
    const board = await createBoard(request, ownerToken, 'Role Change Board');

    await addMember(request, ownerToken, board.id, userB.id, 'viewer');

    const beforeRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const before: any[] = await beforeRes.json();
    const beforeMember = before.find((m) => m.user_id === userB.id || m.id === userB.id);
    expect(beforeMember?.role).toBe('viewer');

    // Remove and re-add as member.
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    const afterRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const after: any[] = await afterRes.json();
    const afterMember = after.find((m) => m.user_id === userB.id || m.id === userB.id);
    expect(afterMember?.role).toBe('member');
  });

  test('After role upgrade viewer→member, user is now blocked from board settings (still not admin)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerUpgrade', 'perm-owner-upg');
    const { token: userBToken, user: userB } = await createUser(request, 'UpgradeUser', 'perm-upgrade-user');
    const board = await createBoard(request, ownerToken, 'Upgrade Board');

    await addMember(request, ownerToken, board.id, userB.id, 'viewer');

    // Remove and re-add as member.
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    // Even as member, board settings update is still forbidden.
    const settingsRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
      data: { name: 'Should Still Fail', description: '' },
    });
    expect(settingsRes.status()).toBe(403);
  });

  test('After role upgrade viewer→member, card creation is unblocked', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerUpgrade2', 'perm-owner-upg2');
    const { token: userBToken, user: userB } = await createUser(request, 'UpgradeUser2', 'perm-upgrade-user2');
    const board = await createBoard(request, ownerToken, 'Upgrade Board 2');
    const swimlane = await createSwimlane(request, ownerToken, board.id);
    const column = await getFirstColumn(request, ownerToken, board.id);

    // Viewer cannot create card.
    await addMember(request, ownerToken, board.id, userB.id, 'viewer');

    const failRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${userBToken}` },
      data: {
        title: 'Should Fail As Viewer',
        board_id: board.id,
        column_id: column.id,
        swimlane_id: swimlane.id,
      },
    });
    expect(failRes.status()).toBe(403);

    // Upgrade to member — card creation should now be permitted.
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    // fixme block: POST /api/cards succeeds at the permission layer but may
    // fail at the Gitea integration layer with 401 when Gitea is unconfigured.
    // We verify the status is NOT 403 (permission accepted).
    const okRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${userBToken}` },
      data: {
        title: 'Should Succeed As Member',
        board_id: board.id,
        column_id: column.id,
        swimlane_id: swimlane.id,
      },
    });
    // 201 = success; 401 = Gitea not configured (tolerated); 403 = still blocked (fail).
    expect(okRes.status()).not.toBe(403);
  });

});

// ---------------------------------------------------------------------------
// 8. Board visibility — public boards (feature does not exist yet)
// ---------------------------------------------------------------------------

test.describe('Board visibility — public/private', () => {

  test.fixme(
    'Public board can be read by unauthenticated users',
    async ({ request }) => {
      // Public board visibility is not yet implemented. All boards are
      // private (members-only) today. When implemented, test that setting
      // a board to "public" allows unauthenticated GET /api/boards/:id.
    },
  );

  test.fixme(
    'Private board returns 403 to unauthenticated users',
    async ({ request }) => {
      // Companion to the above: once public boards exist, verify that
      // private (the default) boards still require authentication.
    },
  );

});
