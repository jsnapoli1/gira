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
  return { token: body.token as string, user: body.user as { id: number; display_name: string; email: string; is_admin: boolean } };
}

async function promoteToAdmin(request: any, token: string) {
  const res = await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
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
    // Create admin + 2 extra users
    const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Multi', 'admin-multi');
    await promoteToAdmin(request, adminToken);
    await createUser(request, 'User B Multi', 'userb-multi');
    await createUser(request, 'User C Multi', 'userc-multi');

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(200);
    const users = await res.json();
    // At least the 3 users created in this test exist
    expect(users.length).toBeGreaterThanOrEqual(3);

    // The admin user should appear in the list
    const found = users.find((u: any) => u.id === adminUser.id);
    expect(found).toBeDefined();
  });

  test('User list response includes is_admin field for admin user', async ({ request }) => {
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

  test('Non-admin user gets 403 from GET /api/admin/users', async ({ request }) => {
    const { token: nonAdminToken } = await createUser(request, 'Non Admin', 'non-admin-list');

    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });

    expect(res.status()).toBe(403);
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

  test('Admin can demote another admin when more than one admin exists', async ({ request }) => {
    const { token: adminToken } = await createUser(request, 'Admin Demote', 'admin-demote');
    await promoteToAdmin(request, adminToken);
    const { user: adminB } = await createUser(request, 'Admin B Demote', 'adminb-demote');

    // Promote User B to admin first
    await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: adminB.id, is_admin: true },
    });

    // Now demote User B — should succeed since there are 2 admins
    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: adminB.id, is_admin: false },
    });

    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.is_admin).toBe(false);
  });

  test('Non-admin cannot promote users via PUT /api/admin/users', async ({ request }) => {
    const { token: nonAdminToken } = await createUser(request, 'Non Admin Promote', 'non-admin-promote');
    const { user: userB } = await createUser(request, 'Target Promote', 'target-promote');

    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
      data: { user_id: userB.id, is_admin: true },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Admin User Management — UI tests
// ---------------------------------------------------------------------------

// NOTE: Settings.tsx has an admin-only "Global Gitea Connection" section but
// NO admin user management UI. The admin.listUsers() / admin.setUserAdmin()
// functions exist in api/client.ts but are not used anywhere in the frontend.
// All UI tests below are marked fixme until an admin user management UI is built.

test.describe('Admin User Management — UI', () => {
  test.fixme(
    'Admin can access user management section in Settings',
    async ({ page, request }) => {
      // No admin user list UI exists in Settings.tsx or any other page.
      // admin.listUsers() is defined in api/client.ts but never called in the UI.
      const { token: adminToken } = await createUser(request, 'Admin UI', 'admin-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      // Expect an admin user management section to exist (not yet implemented)
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

      await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      // Expect at least 3 user rows
      await expect(page.locator('.user-list-item, .admin-user-row')).toHaveCount(3, { timeout: 8000 });
    },
  );

  test.fixme(
    'Admin user has an "Admin" badge in the user list',
    async ({ page, request }) => {
      // No admin user list UI exists — badge rendering not implemented.
      const { token: adminToken, user: adminUser } = await createUser(request, 'Admin Badge UI', 'admin-badge-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      // Expect the admin user's row to have an "Admin" badge
      const adminRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: adminUser.display_name });
      await expect(adminRow.locator('.badge:has-text("Admin"), [data-role="admin"]')).toBeVisible();
    },
  );

  test.fixme(
    'Promote user to admin via admin panel UI',
    async ({ page, request }) => {
      // No promote/toggle admin UI exists in any frontend page.
      // When implemented: navigate to admin panel, find User B, click promote toggle,
      // verify User B shows admin badge.
      const { token: adminToken } = await createUser(request, 'Admin Promote UI', 'admin-promote-ui');
      await promoteToAdmin(request, adminToken);
      const { user: userB } = await createUser(request, 'User B To Promote', 'userb-promote-ui');

      await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      const userBRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: userB.display_name });

      // Click promote/toggle admin button
      page.once('dialog', (d) => d.accept());
      await userBRow.locator('button:has-text("Promote"), button:has-text("Make Admin"), input[type="checkbox"]').click();

      // Verify User B now has the admin badge
      await expect(userBRow.locator('.badge:has-text("Admin")')).toBeVisible({ timeout: 8000 });
    },
  );

  test.fixme(
    'Cannot demote last admin — error shown in UI',
    async ({ page, request }) => {
      // No demote UI exists — no button to remove admin status in Settings.tsx.
      // When implemented: as the only admin, click demote/toggle, verify error message.
      const { token: adminToken, user: adminUser } = await createUser(request, 'Last Admin UI', 'last-admin-ui');
      await promoteToAdmin(request, adminToken);

      await page.addInitScript((t) => localStorage.setItem('token', t), adminToken);
      await page.goto('/settings');

      const adminRow = page.locator('.user-list-item, .admin-user-row').filter({ hasText: adminUser.display_name });

      // Try to demote self
      page.once('dialog', (d) => d.accept());
      await adminRow.locator('button:has-text("Demote"), button:has-text("Remove Admin"), input[type="checkbox"]').click();

      // Expect error message
      await expect(
        page.locator('.error, .alert-error, [role="alert"]').filter({ hasText: /last admin/i })
      ).toBeVisible({ timeout: 8000 });
    },
  );
});
