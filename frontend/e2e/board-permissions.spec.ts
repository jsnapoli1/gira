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
  return (await res.json()) as { id: number; name: string };
}

async function addMember(
  request: any,
  token: string,
  boardId: number,
  userId: number,
  role = 'member',
) {
  return request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

async function createSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Owner can add members via board settings UI
// ---------------------------------------------------------------------------

test.describe('Owner — add members', () => {
  test('Owner adds a user as member via board settings', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAdd', 'perm-owner-add');
    const { user: userB } = await createUser(request, 'NewMemberAdd', 'perm-new-add');
    const board = await createBoard(request, ownerToken, 'Owner Add Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });

    // Open "Add Member" modal
    await membersSection.locator('button:has-text("Add Member")').click();
    await expect(page.locator('.modal h2:has-text("Add Member")')).toBeVisible();

    // Select the new user from the dropdown
    await page.locator('.modal select').first().selectOption({
      label: `${userB.display_name} (${userB.email})`,
    });

    await page.locator('.modal button[type="submit"]:has-text("Add Member")').click();

    // Modal closes and user appears in the list
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Member can create cards
// ---------------------------------------------------------------------------

test.describe('Member — card creation', () => {
  test('User with member role can create a card via the board UI', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerCards', 'perm-owner-cards');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'MemberCards',
      'perm-member-cards',
    );
    const board = await createBoard(request, ownerToken, 'Member Card Board');

    // Create a swimlane so the board view renders columns
    await createSwimlane(request, ownerToken, board.id);
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Navigate as the member
    await page.addInitScript((t) => localStorage.setItem('token', t), memberToken);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Switch to "All Cards" view so all columns are visible
    await page.click('.view-btn:has-text("All Cards")');

    // The add-card-btn is rendered per column; click the first one
    const addBtn = page.locator('.add-card-btn').first();
    await expect(addBtn).toBeVisible({ timeout: 8000 });
    await addBtn.click();

    // Quick-add form should appear
    await expect(page.locator('.quick-add-form')).toBeVisible();

    // Fill in a title and submit
    await page.fill('.quick-add-form input', 'Member Created Card');
    await page.click('.quick-add-form button[type="submit"]');

    // Card should appear in the column
    await expect(page.locator('.card-item:has-text("Member Created Card")')).toBeVisible({
      timeout: 8000,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Viewer cannot create cards (API returns 403)
// ---------------------------------------------------------------------------

test.describe('Viewer — card creation blocked', () => {
  test('API returns 403 when a viewer attempts to create a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewer', 'perm-owner-viewer');
    const { token: viewerToken, user: viewerUser } = await createUser(
      request,
      'ViewerCards',
      'perm-viewer-cards',
    );
    const board = await createBoard(request, ownerToken, 'Viewer Card Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    // Add user as viewer
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    // Fetch columns so we have a valid column_id
    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    const columns = await columnsRes.json();

    // Attempt to POST /api/cards as the viewer
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: {
        title: 'Viewer Should Fail',
        board_id: board.id,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    expect(cardRes.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 4. Non-member gets 403 navigating to board
// ---------------------------------------------------------------------------

test.describe('Non-member — board access denied', () => {
  test('Non-member navigating to board URL sees error, not board content', async ({
    page,
    request,
  }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerPriv', 'perm-owner-priv');
    const { token: nonMemberToken } = await createUser(request, 'NonMember', 'perm-nonmember');
    const board = await createBoard(request, ownerToken, 'Private Board Perm');

    await page.addInitScript((t) => localStorage.setItem('token', t), nonMemberToken);
    await page.goto(`/boards/${board.id}`);

    // BoardView renders .error when the API returns 403
    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Non-member GET /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerApi', 'perm-owner-api');
    const { token: nonMemberToken } = await createUser(request, 'NonMemberApi', 'perm-nm-api');
    const board = await createBoard(request, ownerToken, 'Private API Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5. Admin can modify board settings (rename board)
// ---------------------------------------------------------------------------

test.describe('Admin role — board settings', () => {
  test('User with admin role can rename the board via settings', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerAdmin', 'perm-owner-admin');
    const { token: adminToken, user: adminUser } = await createUser(
      request,
      'AdminMember',
      'perm-admin-member',
    );
    const board = await createBoard(request, ownerToken, 'Admin Rename Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    // Navigate as the admin user
    await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
    await page.goto(`/boards/${board.id}/settings`);

    const nameInput = page.locator('#boardName');
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Admin Renamed Board');

    const saveBtn = page.locator('button:has-text("Save Changes")');
    await saveBtn.click();

    // Wait for save to complete
    await expect(saveBtn).toHaveText('Save Changes', { timeout: 5000 });

    // Reload and verify the name persisted
    await page.reload();
    await expect(page.locator('#boardName')).toHaveValue('Admin Renamed Board');
  });
});

// ---------------------------------------------------------------------------
// 6. Member cannot update board settings (API returns 403)
// ---------------------------------------------------------------------------

test.describe('Member role — board settings blocked', () => {
  test('API returns 403 when a member attempts to update board settings', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMbrSet', 'perm-owner-mbrset');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'MemberSettings',
      'perm-member-settings',
    );
    const board = await createBoard(request, ownerToken, 'Member Settings Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Should Fail', description: '' },
    });

    // Members cannot edit board settings
    expect(res.status()).toBe(403);
  });

  test('Viewer API: PATCH board name returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewSet', 'perm-owner-vwset');
    const { token: viewerToken, user: viewerUser } = await createUser(
      request,
      'ViewerSettings',
      'perm-viewer-settings',
    );
    const board = await createBoard(request, ownerToken, 'Viewer Settings Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Fail', description: '' },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 7. Owner can remove members via settings UI
// ---------------------------------------------------------------------------

test.describe('Owner — remove members', () => {
  test('Owner removes a member from board settings UI', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRemovePerm', 'perm-owner-rm');
    const { user: userB } = await createUser(request, 'MemberToRemovePerm', 'perm-member-rm');
    const board = await createBoard(request, ownerToken, 'Owner Remove Board');

    // Pre-add User B via API
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);

    const membersSection = page.locator('.settings-section').filter({ hasText: 'Members' });
    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).toBeVisible({ timeout: 8000 });

    // Accept the confirmation dialog and click delete
    page.once('dialog', (d) => d.accept());
    await membersSection
      .locator('.settings-list-item')
      .filter({ hasText: userB.display_name })
      .locator('.item-delete')
      .click();

    // User B should no longer appear in the members list
    await expect(
      membersSection.locator(`.item-name:has-text("${userB.display_name}")`),
    ).not.toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 8. Removed member loses access to the board
// ---------------------------------------------------------------------------

test.describe('Removed member — loses board access', () => {
  test('After removal, former member cannot load the board', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerLoseAccess', 'perm-owner-lose');
    const { token: removedToken, user: removedUser } = await createUser(
      request,
      'RemovedMember',
      'perm-removed',
    );
    const board = await createBoard(request, ownerToken, 'Lose Access Board');

    // Add and then immediately remove via API
    await addMember(request, ownerToken, board.id, removedUser.id, 'member');
    await request.delete(`${BASE}/api/boards/${board.id}/members/${removedUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Attempt to access board as the removed user
    await page.addInitScript((t) => localStorage.setItem('token', t), removedToken);
    await page.goto(`/boards/${board.id}`);

    // Should see an error — not the board
    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Removed member GET /api/boards/:id returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerApiLose', 'perm-owner-api-lose');
    const { token: removedToken, user: removedUser } = await createUser(
      request,
      'RemovedApi',
      'perm-removed-api',
    );
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
});

// ---------------------------------------------------------------------------
// 9. Role visible in member list (settings page)
// ---------------------------------------------------------------------------

test.describe('Role visible in member list', () => {
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
});

// ---------------------------------------------------------------------------
// 10. Viewer can read board but cannot post cards (read-only access)
// ---------------------------------------------------------------------------

test.describe('Viewer — read-only access', () => {
  test('Viewer can load the board view', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewRead', 'perm-owner-vr');
    const { token: viewerToken, user: viewerUser } = await createUser(
      request,
      'ViewerRead',
      'perm-viewer-read',
    );
    const board = await createBoard(request, ownerToken, 'Viewer Read Board');

    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    await page.addInitScript((t) => localStorage.setItem('token', t), viewerToken);
    await page.goto(`/boards/${board.id}`);

    // Board should load — viewer has read access
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Viewer Read Board', {
      timeout: 8000,
    });
  });

  test('Viewer GET /api/boards/:id/cards returns 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerViewCards', 'perm-owner-vc');
    const { token: viewerToken, user: viewerUser } = await createUser(
      request,
      'ViewerCards2',
      'perm-viewer-cards2',
    );
    const board = await createBoard(request, ownerToken, 'Viewer Cards Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 11. Role change — re-add member with different role via API
// ---------------------------------------------------------------------------

test.describe('Role change', () => {
  test('Owner changes member role from viewer to member via API (remove + re-add)', async ({
    request,
  }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRoleChg', 'perm-owner-rchg');
    const { user: userB } = await createUser(request, 'RoleChangeUser', 'perm-role-chg');
    const board = await createBoard(request, ownerToken, 'Role Change Board');

    // Initially add as viewer
    await addMember(request, ownerToken, board.id, userB.id, 'viewer');

    // Verify current role via member list
    const beforeRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const before: any[] = await beforeRes.json();
    const beforeMember = before.find((m) => m.user_id === userB.id || m.id === userB.id);
    expect(beforeMember?.role).toBe('viewer');

    // Remove and re-add as member to effect the role change
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    // Verify updated role
    const afterRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const after: any[] = await afterRes.json();
    const afterMember = after.find((m) => m.user_id === userB.id || m.id === userB.id);
    expect(afterMember?.role).toBe('member');
  });

  test('After role upgrade viewer→member, user can now create a card via API', async ({
    request,
  }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerUpgrade', 'perm-owner-upg');
    const { token: userBToken, user: userB } = await createUser(
      request,
      'UpgradeUser',
      'perm-upgrade-user',
    );
    const board = await createBoard(request, ownerToken, 'Upgrade Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const columns = await columnsRes.json();

    // Add as viewer — card creation should fail
    await addMember(request, ownerToken, board.id, userB.id, 'viewer');

    const failRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${userBToken}` },
      data: {
        title: 'Should Fail As Viewer',
        board_id: board.id,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    expect(failRes.status()).toBe(403);

    // Remove and re-add as member — card creation should now succeed
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, userB.id, 'member');

    const okRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${userBToken}` },
      data: {
        title: 'Should Succeed As Member',
        board_id: board.id,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    expect(okRes.status()).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 12. Member cannot add other members (admin-only operation)
// ---------------------------------------------------------------------------

test.describe('Member — cannot manage members', () => {
  test('Member cannot add another user to the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerMgrMbr', 'perm-owner-mgr');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'MemberMgr',
      'perm-member-mgr',
    );
    const { user: thirdUser } = await createUser(request, 'ThirdUser', 'perm-third');
    const board = await createBoard(request, ownerToken, 'Member Manage Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Member tries to add a third user
    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: thirdUser.id, role: 'member' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member cannot remove another member from the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'OwnerRmMbr', 'perm-owner-rmmb');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'MemberRm',
      'perm-member-rm2',
    );
    const { user: targetUser } = await createUser(request, 'TargetRm', 'perm-target-rm');
    const board = await createBoard(request, ownerToken, 'Member Remove Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');
    await addMember(request, ownerToken, board.id, targetUser.id, 'member');

    // Member tries to remove the other member
    const res = await request.delete(
      `${BASE}/api/boards/${board.id}/members/${targetUser.id}`,
      { headers: { Authorization: `Bearer ${memberToken}` } },
    );

    expect(res.status()).toBe(403);
  });
});
