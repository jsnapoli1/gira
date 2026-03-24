/**
 * Admin panel E2E tests for Zira.
 *
 * Covers:
 *   - Admin-only API endpoints (GET/PUT /api/admin/users, POST /api/config)
 *   - Admin promotion and demotion logic
 *   - App-admin board-access bypass (app admins can access any board)
 *   - Admin UI in Settings page (currently unimplemented — fixme'd)
 *
 * Architecture notes (verified in source):
 *   - POST /api/auth/promote-admin allows any authenticated user to
 *     self-promote (no guard). This is a known bug documented in security-tests.spec.ts.
 *     These tests exploit this path intentionally to bootstrap an admin for testing.
 *   - GET  /api/admin/users  — requireAdmin middleware (403 for non-admins)
 *   - PUT  /api/admin/users  — requireAdmin middleware (403 for non-admins)
 *   - POST /api/config       — requireAdmin middleware (403 for non-admins)
 *   - models.User.PasswordHash has json:"-" so it never appears in responses.
 *   - No admin UI page exists (/admin route is absent). Settings.tsx has a
 *     "Global Gitea Connection" section visible only to admins, but no user
 *     management UI.
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
    user: body.user as { id: number; display_name: string; email: string; is_admin: boolean },
  };
}

/**
 * Self-promotes the calling user to admin via the known-bug path.
 * POST /api/auth/promote-admin with no body promotes the caller unconditionally.
 * This is a known security bug (see security-tests.spec.ts Bug 6), but we
 * exploit it here intentionally to get a valid admin token for test setup.
 */
async function promoteToAdmin(request: any, token: string) {
  const res = await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
}

async function createBoard(request: any, token: string, name = 'Test Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeLessThan(300);
  return res.json() as Promise<{ id: number; name: string }>;
}

// ---------------------------------------------------------------------------
// Admin User List — API tests
// ---------------------------------------------------------------------------

test.describe('Admin User List — API', () => {

  test('Admin can retrieve user list via GET /api/admin/users', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin List', 'admin-list');
    await promoteToAdmin(request, adminToken);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const users = await res.json();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(1);
  });

  test('User list shows all users — at least 3 when 3 exist', async ({ request }) => {
    const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Multi', 'admin-multi');
    await promoteToAdmin(request, adminToken);
    await createUser(request, 'User B Multi', 'userb-multi');
    await createUser(request, 'User C Multi', 'userc-multi');

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const users = await res.json();
    // At least the 3 users created in this test run exist.
    expect(users.length).toBeGreaterThanOrEqual(3);

    // The admin user should appear in the list.
    const found = users.find((u: any) => u.id === adminUser.id);
    expect(found).toBeDefined();
  });

  test('User list response includes is_admin field set to true for promoted admin', async ({ request }) => {
    const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Badge', 'admin-badge');
    await promoteToAdmin(request, adminToken);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const users = await res.json();
    const adminEntry = users.find((u: any) => u.id === adminUser.id);
    expect(adminEntry).toBeDefined();
    expect(adminEntry.is_admin).toBe(true);
  });

  test('User list response does not include password_hash for any user', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin PW Check', 'admin-pw-check');
    await promoteToAdmin(request, adminToken);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const raw = await res.text();
    // PasswordHash is tagged with json:"-" in models.User and must never appear.
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('PasswordHash');
  });

  test('Non-admin user gets 403 from GET /api/admin/users', async ({ request }) => {
    const { token: nonAdminToken } = await createUser(request, 'Non Admin List', 'non-admin-list');

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Unauthenticated request to GET /api/admin/users returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/users`);
    // requireAdmin wraps requireAuth — 401 is returned before the admin check.
    expect(res.status()).toBe(401);
  });

  test('User list items include id, email, display_name, and is_admin fields', async ({ request }) => {
    const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Fields', 'admin-fields');
    await promoteToAdmin(request, adminToken);

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const users = await res.json();
    const entry = users.find((u: any) => u.id === adminUser.id);
    expect(entry).toBeDefined();
    expect(typeof entry.id).toBe('number');
    expect(typeof entry.email).toBe('string');
    expect(typeof entry.display_name).toBe('string');
    expect(typeof entry.is_admin).toBe('boolean');
  });

});

// ---------------------------------------------------------------------------
// Admin Actions — API tests
// ---------------------------------------------------------------------------

test.describe('Admin Actions — API', () => {

  test('Admin can promote another user to admin via PUT /api/admin/users', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Promote', 'admin-promote');
    await promoteToAdmin(request, adminToken);
    const { user: userB } = await createUser(request, 'User B Promote', 'userb-promote');

    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: userB.id, is_admin: true },
    });

    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.is_admin).toBe(true);
    expect(updated.id).toBe(userB.id);
  });

  test('Admin can demote another admin when more than one admin exists', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Demote', 'admin-demote');
    await promoteToAdmin(request, adminToken);
    const { user: adminB } = await createUser(request, 'Admin B Demote', 'adminb-demote');

    // Promote userB to admin first.
    const promoteRes = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: adminB.id, is_admin: true },
    });
    expect(promoteRes.status()).toBe(200);

    // Now demote userB — should succeed since there are at least 2 admins.
    const demoteRes = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: adminB.id, is_admin: false },
    });

    expect(demoteRes.status()).toBe(200);
    const updated = await demoteRes.json();
    expect(updated.is_admin).toBe(false);
  });

  test.fixme(
    'Cannot demote the last admin — returns 400 with error message',
    async ({ request }) => {
      // This test requires a clean database where only one admin exists.
      // The shared test DB accumulates admin users from prior runs, so the
      // "last admin" guard (adminCount <= 1) is never triggered here.
      // To verify: run against a fresh DB with exactly one admin, then attempt
      // PUT /api/admin/users { user_id: <admin-id>, is_admin: false } and
      // confirm the response is 400 with body "Cannot remove the last admin".
      //
      // The guard logic exists in internal/server/admin_handlers.go:64.
      const { token: adminToken, user: adminUser } = await createUser(request, 'Last Admin', 'last-admin');
      await promoteToAdmin(request, adminToken);

      const res = await request.put(`${BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { user_id: adminUser.id, is_admin: false },
      });

      expect(res.status()).toBe(400);
      const body = await res.text();
      expect(body).toContain('Cannot remove the last admin');
    },
  );

  test('Non-admin cannot promote users via PUT /api/admin/users', async ({ request }) => {
    const { token: nonAdminToken } = await createUser(request, 'Non Admin Promote', 'non-admin-promote');
    const { user: userB } = await createUser(request, 'Target Promote', 'target-promote');

    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
      data: { user_id: userB.id, is_admin: true },
    });

    expect(res.status()).toBe(403);
  });

  test('Unauthenticated request to PUT /api/admin/users returns 401', async ({ request }) => {
    const res = await request.put(`${BASE}/api/admin/users`, {
      data: { user_id: 1, is_admin: true },
    });
    expect(res.status()).toBe(401);
  });

  test('PUT /api/admin/users with non-existent user_id returns 404', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin 404', 'admin-404');
    await promoteToAdmin(request, adminToken);

    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: 999999999, is_admin: true },
    });

    // handleUpdateAdminUser calls GetUserByID and returns 404 if user is nil.
    expect(res.status()).toBe(404);
  });

  test('PUT /api/admin/users with invalid body returns 400', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Bad Body', 'admin-bad-body');
    await promoteToAdmin(request, adminToken);

    const res = await request.put(`${BASE}/api/admin/users`, {
      data: 'not-json',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'text/plain',
      },
    });

    expect(res.status()).toBe(400);
  });

  test('Promoted user is_admin reflects true in subsequent GET /api/auth/me', async ({ request }) => {
    const { token } = await createUser(request, 'PromoteMe', 'admin-promote-me');
    await promoteToAdmin(request, token);

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await res.json();
    expect(me.is_admin).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// App-admin board access bypass
// ---------------------------------------------------------------------------

test.describe('App Admin — Board Access Bypass', () => {

  // App admins (is_admin = true) bypass board membership checks entirely.
  // This is enforced in loadBoardAndRole() (board_handlers.go) and
  // requireBoardRole() (server.go).

  test('App admin can read a board they do not own or belong to', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Board Owner Admin Bypass', 'admin-bypass-owner');
    const { token: adminToken } = await createUser(request, 'App Admin Bypass', 'admin-bypass-admin');
    await promoteToAdmin(request, adminToken);

    const board = await createBoard(request, ownerToken, 'Admin Bypass Board');

    // App admin is not a board member but should get 200.
    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(board.id);
  });

  test('App admin can update a board they do not own or belong to', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Board Owner Admin Edit', 'admin-edit-owner');
    const { token: adminToken } = await createUser(request, 'App Admin Edit', 'admin-edit-admin');
    await promoteToAdmin(request, adminToken);

    const board = await createBoard(request, ownerToken, 'Admin Edit Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Renamed Board', description: '' },
    });

    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe('Admin Renamed Board');
  });

  test('App admin can list board members they are not a member of', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Board Owner Members', 'admin-members-owner');
    const { token: adminToken } = await createUser(request, 'App Admin Members', 'admin-members-admin');
    await promoteToAdmin(request, adminToken);

    const board = await createBoard(request, ownerToken, 'Admin Members Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const members = await res.json();
    expect(Array.isArray(members)).toBe(true);
  });

  test('Non-admin cannot read another user\'s private board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Board Private Owner', 'admin-private-owner');
    const { token: nonAdminToken } = await createUser(request, 'Non Admin Reader', 'admin-private-reader');

    const board = await createBoard(request, ownerToken, 'Private Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });

    // Non-member non-admin should be forbidden from accessing the board.
    expect(res.status()).toBe(403);
  });

});

// ---------------------------------------------------------------------------
// Admin — POST /api/config (Gitea configuration)
// ---------------------------------------------------------------------------

test.describe('Admin — Gitea Config Endpoint', () => {

  test('Admin can call POST /api/config without 403', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Config Test', 'admin-config-test');
    await promoteToAdmin(request, adminToken);

    // We don't expect this to succeed (the Gitea URL may be unreachable),
    // but we do expect the admin check to pass (not 403 or 401).
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { gitea_url: 'http://127.0.0.1:3000', gitea_api_key: 'fake-key-for-test' },
    });
    // 200 (saved), 400 (validation), or 5xx (connection error) — but NOT 401/403.
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
  });

  test('Non-admin cannot call POST /api/config', async ({ request }) => {
    const { token } = await createUser(request, 'Non Admin Config', 'non-admin-config');

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'http://example.com', gitea_api_key: 'fake' },
    });

    expect(res.status()).toBe(403);
  });

  test('POST /api/config returns 400 when gitea_url is empty', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Config No Url', 'admin-config-no-url');
    await promoteToAdmin(request, adminToken);

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { gitea_url: '', gitea_api_key: 'fake' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST /api/config returns 400 when api_key missing for initial configuration', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Config No Key', 'admin-config-no-key');
    await promoteToAdmin(request, adminToken);

    // Only send URL, no API key — initial config requires the key
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { gitea_url: 'http://127.0.0.1:3000' },
    });

    // Either 400 (no key) or 200 (already configured from previous test run is fine)
    expect([200, 400]).toContain(res.status());
  });

  test('GET /api/config/status returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/config/status returns 200 with configured boolean', async ({ request }) => {
    const { token } = await createUser(request, 'Config Status User', 'admin-config-status');

    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
  });

});

// ---------------------------------------------------------------------------
// Admin — Settings UI (what actually exists)
// ---------------------------------------------------------------------------

test.describe('Admin — Settings Page UI', () => {

  test('Admin user sees Global Gitea Connection section in settings', async ({ page, request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Settings Vis', 'admin-settings-vis');
    await promoteToAdmin(request, adminToken);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('Admin user sees Gitea URL and API Key form fields in settings', async ({ page, request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Form Fields', 'admin-form-fields');
    await promoteToAdmin(request, adminToken);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
    await page.goto('/settings');

    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#giteaApiKey')).toBeVisible({ timeout: 8000 });
  });

  test('Admin user sees Save/Update Configuration button in settings', async ({ page, request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Save Btn', 'admin-save-btn');
    await promoteToAdmin(request, adminToken);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
    await page.goto('/settings');

    await expect(
      page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('Non-admin does not see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request, 'Non Admin Settings', 'non-admin-settings');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });

  test('Non-admin does not see Gitea URL or API Key inputs', async ({ page, request }) => {
    const { token } = await createUser(request, 'Non Admin No Form', 'non-admin-no-form');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('#giteaUrl')).not.toBeVisible();
    await expect(page.locator('#giteaApiKey')).not.toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// Admin User Management — UI tests
// ---------------------------------------------------------------------------

// NOTE: Settings.tsx has an admin-only "Global Gitea Connection" section but
// NO admin user management UI. The admin.listUsers() / admin.setUserAdmin()
// functions exist in api/client.ts but are not used anywhere in the frontend.
// The /admin route does not exist in App.tsx. All UI tests below are marked
// fixme until an admin user management UI is built.

test.describe('Admin User Management — UI', () => {

  test.fixme(
    'Admin can access user management section in Settings',
    async ({ page, request }) => {
      // No admin user list UI exists in Settings.tsx or any other page.
      // admin.listUsers() is defined in api/client.ts but never called in the UI.
      const { token: adminToken } = await createUser(request, 'Admin UI', 'admin-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      // Expect an admin user management section to exist (not yet implemented).
      await expect(
        page.locator('.settings-section h2:has-text("User Management"), h2:has-text("Users"), h2:has-text("Admin")')
      ).toBeVisible();
    },
  );

  test.fixme(
    'User list shows all users in admin UI',
    async ({ page, request }) => {
      // No admin user list UI exists — would need a dedicated page or settings section.
      const { token: adminToken } = await createUser(request, 'Admin UI List', 'admin-ui-list');
      await promoteToAdmin(request, adminToken);
      await createUser(request, 'User B UI', 'userb-ui');
      await createUser(request, 'User C UI', 'userc-ui');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      // Expect at least 3 user rows.
      await expect(page.locator('.user-list-item, .admin-user-row')).toHaveCount(3, { timeout: 8000 });
    },
  );

  test.fixme(
    'Admin user has an "Admin" badge in the user list',
    async ({ page, request }) => {
      // No admin user list UI exists — badge rendering not implemented.
      const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Badge UI', 'admin-badge-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      const adminRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: adminUser.display_name });
      await expect(adminRow.locator('.badge:has-text("Admin"), [data-role="admin"]')).toBeVisible();
    },
  );

  test.fixme(
    'Promote user to admin via admin panel UI',
    async ({ page, request }) => {
      // No promote/toggle admin UI exists in any frontend page.
      // When implemented: navigate to admin panel, find User B, click promote
      // toggle, verify User B shows admin badge.
      const { token: adminToken } = await createUser(request, 'Admin Promote UI', 'admin-promote-ui');
      await promoteToAdmin(request, adminToken);
      const { user: userB } = await createUser(request, 'User B To Promote', 'userb-promote-ui');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      const userBRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: userB.display_name });

      page.once('dialog', (d) => d.accept());
      await userBRow.locator('button:has-text("Promote"), button:has-text("Make Admin"), input[type="checkbox"]').click();

      await expect(userBRow.locator('.badge:has-text("Admin")')).toBeVisible({ timeout: 8000 });
    },
  );

  test.fixme(
    'Cannot demote last admin — error shown in UI',
    async ({ page, request }) => {
      // No demote UI exists — no button to remove admin status in Settings.tsx.
      // When implemented: as the only admin, click demote/toggle, verify error.
      const { token: adminToken, user: adminUser } = await createUser(request, 'Last Admin UI', 'last-admin-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      const adminRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: adminUser.display_name });

      page.once('dialog', (d) => d.accept());
      await adminRow.locator('button:has-text("Demote"), button:has-text("Remove Admin"), input[type="checkbox"]').click();

      await expect(
        page.locator('.error, .alert-error, [role="alert"]').filter({ hasText: /last admin/i })
      ).toBeVisible({ timeout: 8000 });
    },
  );

  test.fixme(
    'Non-admin user does not see admin section in Settings',
    async ({ page, request }) => {
      // When the admin section is built, it should be hidden for non-admins.
      const { token } = await createUser(request, 'Non Admin UI Check', 'non-admin-ui-check');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/settings');

      await expect(
        page.locator('.settings-section h2:has-text("User Management"), h2:has-text("Admin")')
      ).not.toBeVisible();
    },
  );

  test.fixme(
    '/admin route exists and is accessible to admins',
    async ({ page, request }) => {
      // No /admin route exists in App.tsx. This test documents the expected
      // future behaviour. When a dedicated admin page is implemented, remove fixme.
      const { token: adminToken } = await createUser(request, 'Admin Route User', 'admin-route');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t: string) => localStorage.setItem('token', t), adminToken);
      await page.goto('/admin');

      await expect(page).toHaveURL(/\/admin/);
      await expect(page.locator('h1, h2').first()).toBeVisible();
    },
  );

  test.fixme(
    '/admin route redirects non-admins to /dashboard or /settings',
    async ({ page, request }) => {
      // No /admin route exists yet. When built, non-admins should be redirected.
      const { token } = await createUser(request, 'Non Admin Route', 'non-admin-route');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/admin');

      await expect(page).not.toHaveURL(/\/admin/);
    },
  );

});
