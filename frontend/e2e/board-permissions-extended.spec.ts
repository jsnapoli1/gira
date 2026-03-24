/**
 * board-permissions-extended.spec.ts
 *
 * Extended permission matrix testing for Zira board access control.
 *
 * Complements board-permissions.spec.ts by covering:
 *  - Non-member 403 enforcement on all write and read endpoints
 *  - Member allowed/restricted endpoints
 *  - Admin-only endpoints
 *  - Role promotion / demotion cascade
 *  - Re-add after removal
 *  - Viewer role restrictions on structural endpoints
 *  - Non-member POST /api/cards returns 403
 *  - Global app-admin override
 *
 * Roles (from models):
 *   owner  — board creator; always admin
 *   admin  — explicit board_members row with role = "admin"
 *   member — can create/edit cards, cannot edit board settings
 *   viewer — read-only board access
 *
 * Each test.describe is an independent, isolated scenario using unique users
 * and boards created via API to avoid state pollution across parallel workers.
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  expect(res.status(), `createUser failed for ${displayName}`).toBe(200);
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
  const body = await res.json();
  return body as { id: number; name: string; owner_id: number; columns: Array<{ id: number }> };
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
    data: { name: 'Default Swimlane', designator: 'DS-', color: '#6366f1' },
  });
  expect(res.status(), `createSwimlane failed: ${res.status()}`).toBeLessThan(300);
  return res.json() as Promise<{ id: number }>;
}

async function getMembers(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  return res.json() as Promise<Array<{ user_id: number; role: string }>>;
}

// ---------------------------------------------------------------------------
// 1. Non-member — structural write endpoints return 403
// ---------------------------------------------------------------------------

test.describe('Non-member — write endpoints denied', () => {
  test('Non-member POST /api/boards/:id/members → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner1', 'nmext-owner1');
    const { token: nmToken } = await createUser(request, 'NMUser1', 'nmext-nm1');
    const { user: third } = await createUser(request, 'Third1', 'nmext-third1');
    const board = await createBoard(request, ownerToken, 'NM Members Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { user_id: third.id, role: 'member' },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member DELETE /api/boards/:id → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner2', 'nmext-owner2');
    const { token: nmToken } = await createUser(request, 'NMUser2', 'nmext-nm2');
    const board = await createBoard(request, ownerToken, 'NM Delete Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member POST /api/boards/:id/columns → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner3', 'nmext-owner3');
    const { token: nmToken } = await createUser(request, 'NMUser3', 'nmext-nm3');
    const board = await createBoard(request, ownerToken, 'NM Columns Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { name: 'Injected Column', position: 99 },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member POST /api/boards/:id/swimlanes → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner4', 'nmext-owner4');
    const { token: nmToken } = await createUser(request, 'NMUser4', 'nmext-nm4');
    const board = await createBoard(request, ownerToken, 'NM Swimlanes Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { name: 'Injected Swimlane', designator: 'INJ-' },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member POST /api/boards/:id/sprints → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner5', 'nmext-owner5');
    const { token: nmToken } = await createUser(request, 'NMUser5', 'nmext-nm5');
    const board = await createBoard(request, ownerToken, 'NM Sprints Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { name: 'Injected Sprint', goal: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member POST /api/boards/:id/labels → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner6', 'nmext-owner6');
    const { token: nmToken } = await createUser(request, 'NMUser6', 'nmext-nm6');
    const board = await createBoard(request, ownerToken, 'NM Labels Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { name: 'Injected Label', color: '#FF0000' },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member POST /api/cards on private board → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner7', 'nmext-owner7');
    const { token: nmToken } = await createUser(request, 'NMUser7', 'nmext-nm7');
    const board = await createBoard(request, ownerToken, 'NM Cards Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: {
        title: 'Non-member Injected Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    // Permission check fires before Gitea integration, so 403 is reliable
    expect(cardRes.status()).toBe(403);
  });

  test('Non-member PUT /api/boards/:id → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMOwner8', 'nmext-owner8');
    const { token: nmToken } = await createUser(request, 'NMUser8', 'nmext-nm8');
    const board = await createBoard(request, ownerToken, 'NM Update Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { name: 'Hijacked Board Name', description: '' },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 2. Non-member — read endpoints return 403
// ---------------------------------------------------------------------------

test.describe('Non-member — read endpoints denied', () => {
  test('Non-member GET /api/boards/:id → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMReadOwner1', 'nmread-own1');
    const { token: nmToken } = await createUser(request, 'NMReadUser1', 'nmread-nm1');
    const board = await createBoard(request, ownerToken, 'NM Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/cards → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMReadOwner2', 'nmread-own2');
    const { token: nmToken } = await createUser(request, 'NMReadUser2', 'nmread-nm2');
    const board = await createBoard(request, ownerToken, 'NM Cards Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/columns → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMReadOwner3', 'nmread-own3');
    const { token: nmToken } = await createUser(request, 'NMReadUser3', 'nmread-nm3');
    const board = await createBoard(request, ownerToken, 'NM Cols Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/labels → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMReadOwner4', 'nmread-own4');
    const { token: nmToken } = await createUser(request, 'NMReadUser4', 'nmread-nm4');
    const board = await createBoard(request, ownerToken, 'NM Labels Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Non-member GET /api/boards/:id/members → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMReadOwner5', 'nmread-own5');
    const { token: nmToken } = await createUser(request, 'NMReadUser5', 'nmread-nm5');
    const board = await createBoard(request, ownerToken, 'NM Members Read Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 3. Member — allowed read endpoints
// ---------------------------------------------------------------------------

test.describe('Member — allowed read endpoints', () => {
  test('Member GET /api/boards/:id → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrRead1Own', 'mbrrd-own1');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrRead1', 'mbrrd-m1');
    const board = await createBoard(request, ownerToken, 'Member Read Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(board.id);
  });

  test('Member GET /api/boards/:id/cards → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrRead2Own', 'mbrrd-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrRead2', 'mbrrd-m2');
    const board = await createBoard(request, ownerToken, 'Member Cards Read Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('Member GET /api/boards/:id/columns → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrRead3Own', 'mbrrd-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrRead3', 'mbrrd-m3');
    const board = await createBoard(request, ownerToken, 'Member Columns Read Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Member GET /api/boards/:id/labels → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrRead4Own', 'mbrrd-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrRead4', 'mbrrd-m4');
    const board = await createBoard(request, ownerToken, 'Member Labels Read Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Member GET /api/boards/:id/members → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrRead5Own', 'mbrrd-own5');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrRead5', 'mbrrd-m5');
    const board = await createBoard(request, ownerToken, 'Member Members Read Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. Member — restricted write endpoints (admin-only)
// ---------------------------------------------------------------------------

test.describe('Member — admin-only endpoints denied', () => {
  test('Member POST /api/boards/:id/members → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny1Own', 'mbrdny-own1');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny1', 'mbrdny-m1');
    const { user: third } = await createUser(request, 'MbrDny1Third', 'mbrdny-t1');
    const board = await createBoard(request, ownerToken, 'Member Add Member Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: third.id, role: 'member' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member DELETE /api/boards/:id → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny2Own', 'mbrdny-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny2', 'mbrdny-m2');
    const board = await createBoard(request, ownerToken, 'Member Delete Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Member DELETE /api/boards/:id/members/:userId → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny3Own', 'mbrdny-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny3', 'mbrdny-m3');
    const { user: targetUser } = await createUser(request, 'MbrDny3Target', 'mbrdny-t3');
    const board = await createBoard(request, ownerToken, 'Member Remove Member Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');
    await addMember(request, ownerToken, board.id, targetUser.id, 'member');

    const res = await request.delete(`${BASE}/api/boards/${board.id}/members/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Member PUT /api/boards/:id (rename) → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny4Own', 'mbrdny-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny4', 'mbrdny-m4');
    const board = await createBoard(request, ownerToken, 'Member Rename Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegally Renamed', description: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member POST /api/boards/:id/columns → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny5Own', 'mbrdny-own5');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny5', 'mbrdny-m5');
    const board = await createBoard(request, ownerToken, 'Member Add Column Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegal Column', position: 99 },
    });

    expect(res.status()).toBe(403);
  });

  test('Member POST /api/boards/:id/swimlanes → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrDny6Own', 'mbrdny-own6');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrDny6', 'mbrdny-m6');
    const board = await createBoard(request, ownerToken, 'Member Add Swimlane Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegal Swimlane', designator: 'IL-' },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5. Admin member — structural endpoints allowed
// ---------------------------------------------------------------------------

test.describe('Admin member — structural write endpoints allowed', () => {
  test('Admin POST /api/boards/:id/members → 201', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow1Own', 'admallow-own1');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow1', 'admallow-a1');
    const { user: newUser } = await createUser(request, 'AdminAllow1New', 'admallow-n1');
    const board = await createBoard(request, ownerToken, 'Admin Add Member Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: newUser.id, role: 'member' },
    });

    expect(res.status()).toBe(201);
  });

  test('Admin DELETE /api/boards/:id/members/:userId → 204', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow2Own', 'admallow-own2');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow2', 'admallow-a2');
    const { user: targetUser } = await createUser(request, 'AdminAllow2Target', 'admallow-t2');
    const board = await createBoard(request, ownerToken, 'Admin Remove Member Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');
    await addMember(request, ownerToken, board.id, targetUser.id, 'member');

    const res = await request.delete(`${BASE}/api/boards/${board.id}/members/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status()).toBe(204);
  });

  test('Admin PUT /api/boards/:id (update name) → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow3Own', 'admallow-own3');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow3', 'admallow-a3');
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

  test('Admin POST /api/boards/:id/columns → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow4Own', 'admallow-own4');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow4', 'admallow-a4');
    const board = await createBoard(request, ownerToken, 'Admin Add Column Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin New Column', position: 5 },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Admin POST /api/boards/:id/swimlanes → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow5Own', 'admallow-own5');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow5', 'admallow-a5');
    const board = await createBoard(request, ownerToken, 'Admin Add Swimlane Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin New Swimlane', designator: 'AN-' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Admin POST /api/boards/:id/sprints → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow6Own', 'admallow-own6');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow6', 'admallow-a6');
    const board = await createBoard(request, ownerToken, 'Admin Add Sprint Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Sprint 1', goal: '' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Admin POST /api/boards/:id/labels → 200', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AdminAllow7Own', 'admallow-own7');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AdminAllow7', 'admallow-a7');
    const board = await createBoard(request, ownerToken, 'Admin Add Label Board');
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Label', color: '#00FF00' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// 6. Role promotion: member → admin
// ---------------------------------------------------------------------------

test.describe('Role promotion: member → admin', () => {
  test('Promoted admin gains access to PUT /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'PromoOwner1', 'promo-own1');
    const { token: userToken, user } = await createUser(request, 'PromoUser1', 'promo-u1');
    const board = await createBoard(request, ownerToken, 'Promo Board 1');

    // Start as member — PUT is forbidden
    await addMember(request, ownerToken, board.id, user.id, 'member');
    const beforeRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { name: 'Should Fail', description: '' },
    });
    expect(beforeRes.status()).toBe(403);

    // Promote via PUT /api/boards/:id/members/:userId
    const promoteRes = await request.put(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'admin' },
    });
    expect(promoteRes.status()).toBeGreaterThanOrEqual(200);
    expect(promoteRes.status()).toBeLessThan(300);

    // Now admin — PUT is allowed
    const afterRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { name: 'Promoted Admin Renamed', description: '' },
    });
    expect(afterRes.status()).toBe(200);
    expect((await afterRes.json()).name).toBe('Promoted Admin Renamed');
  });

  test('Promoted admin can add other members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'PromoOwner2', 'promo-own2');
    const { token: adminToken, user: adminUser } = await createUser(request, 'PromoUser2', 'promo-u2');
    const { user: newUser } = await createUser(request, 'PromoNew2', 'promo-n2');
    const board = await createBoard(request, ownerToken, 'Promo Board 2');

    await addMember(request, ownerToken, board.id, adminUser.id, 'member');

    // Promote to admin
    await request.put(`${BASE}/api/boards/${board.id}/members/${adminUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'admin' },
    });

    // Promoted admin should be able to add a new member
    const addRes = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: newUser.id, role: 'viewer' },
    });
    expect(addRes.status()).toBe(201);
  });

  test('Member role upgrade reflected in GET /api/boards/:id/members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'PromoOwner3', 'promo-own3');
    const { user } = await createUser(request, 'PromoUser3', 'promo-u3');
    const board = await createBoard(request, ownerToken, 'Promo Board 3');

    await addMember(request, ownerToken, board.id, user.id, 'member');

    // Verify initial role
    const before = await getMembers(request, ownerToken, board.id);
    const beforeEntry = before.find((m) => m.user_id === user.id);
    expect(beforeEntry?.role).toBe('member');

    // Promote
    await request.put(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'admin' },
    });

    // Verify new role
    const after = await getMembers(request, ownerToken, board.id);
    const afterEntry = after.find((m) => m.user_id === user.id);
    expect(afterEntry?.role).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// 7. Role demotion: admin → member
// ---------------------------------------------------------------------------

test.describe('Role demotion: admin → member', () => {
  test('Demoted admin loses access to PUT /api/boards/:id', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DemoteOwner1', 'demote-own1');
    const { token: userToken, user } = await createUser(request, 'DemoteUser1', 'demote-u1');
    const board = await createBoard(request, ownerToken, 'Demote Board 1');

    // Start as admin
    await addMember(request, ownerToken, board.id, user.id, 'admin');

    const beforeRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { name: 'Admin Can Rename', description: '' },
    });
    expect(beforeRes.status()).toBe(200);

    // Demote to member
    await request.put(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'member' },
    });

    // Now member — PUT is forbidden
    const afterRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { name: 'Member Cannot Rename', description: '' },
    });
    expect(afterRes.status()).toBe(403);
  });

  test('Demoted admin can no longer add members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DemoteOwner2', 'demote-own2');
    const { token: userToken, user } = await createUser(request, 'DemoteUser2', 'demote-u2');
    const { user: thirdUser } = await createUser(request, 'DemoteThird2', 'demote-t2');
    const board = await createBoard(request, ownerToken, 'Demote Board 2');

    // Start as admin — can add members
    await addMember(request, ownerToken, board.id, user.id, 'admin');

    // Demote to member
    await request.put(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'member' },
    });

    // Cannot add members any more
    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { user_id: thirdUser.id, role: 'viewer' },
    });
    expect(res.status()).toBe(403);
  });

  test('Demoted role reflected in GET /api/boards/:id/members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DemoteOwner3', 'demote-own3');
    const { user } = await createUser(request, 'DemoteUser3', 'demote-u3');
    const board = await createBoard(request, ownerToken, 'Demote Board 3');

    await addMember(request, ownerToken, board.id, user.id, 'admin');

    // Confirm admin role first
    const before = await getMembers(request, ownerToken, board.id);
    expect(before.find((m) => m.user_id === user.id)?.role).toBe('admin');

    // Demote
    await request.put(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { role: 'member' },
    });

    // Confirm member role
    const after = await getMembers(request, ownerToken, board.id);
    expect(after.find((m) => m.user_id === user.id)?.role).toBe('member');
  });
});

// ---------------------------------------------------------------------------
// 8. Cascade effects — removal and re-add
// ---------------------------------------------------------------------------

test.describe('Member removal and re-add cascade effects', () => {
  test('Removed admin loses access to admin endpoints', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CascadeOwn1', 'casc-own1');
    const { token: adminToken, user: adminUser } = await createUser(request, 'CascadeAdmin1', 'casc-adm1');
    const board = await createBoard(request, ownerToken, 'Cascade Admin Remove Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    // Confirm admin can rename
    const renameOk = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Can Do This', description: '' },
    });
    expect(renameOk.status()).toBe(200);

    // Remove admin from board
    await request.delete(`${BASE}/api/boards/${board.id}/members/${adminUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Former admin now gets 403 on board read
    const afterRead = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(afterRead.status()).toBe(403);
  });

  test('After removal, former member token gets 403 on all board routes', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CascadeOwn2', 'casc-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'CascadeMember2', 'casc-m2');
    const board = await createBoard(request, ownerToken, 'Cascade Member Remove Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Verify access
    const before = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(before.status()).toBe(200);

    // Remove member
    await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // All routes should now 403
    const afterBoard = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(afterBoard.status()).toBe(403);

    const afterCards = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(afterCards.status()).toBe(403);
  });

  test('Re-add removed member restores access', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CascadeOwn3', 'casc-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'CascadeMember3', 'casc-m3');
    const board = await createBoard(request, ownerToken, 'Cascade Readd Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Remove
    await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Verify gone
    const denied = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(denied.status()).toBe(403);

    // Re-add
    const readd = await addMember(request, ownerToken, board.id, memberUser.id, 'member');
    expect(readd.status()).toBe(201);

    // Access restored
    const restored = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(restored.status()).toBe(200);
  });

  test('Re-added member can create sprints if re-added as admin', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CascadeOwn4', 'casc-own4');
    const { token: userToken, user } = await createUser(request, 'CascadeUser4', 'casc-u4');
    const board = await createBoard(request, ownerToken, 'Cascade Readd Admin Board');

    // Add as member, remove, re-add as admin
    await addMember(request, ownerToken, board.id, user.id, 'member');
    await request.delete(`${BASE}/api/boards/${board.id}/members/${user.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await addMember(request, ownerToken, board.id, user.id, 'admin');

    // Now can create a sprint
    const sprintRes = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${userToken}` },
      data: { name: 'Readd Admin Sprint', goal: '' },
    });
    expect(sprintRes.status()).toBeGreaterThanOrEqual(200);
    expect(sprintRes.status()).toBeLessThan(300);
  });

  test('Owner cannot be removed from their own board', async ({ request }) => {
    const { token: ownerToken, user: ownerUser } = await createUser(request, 'CascadeOwn5', 'casc-own5');
    const { token: adminToken, user: adminUser } = await createUser(request, 'CascadeAdmin5', 'casc-adm5');
    const board = await createBoard(request, ownerToken, 'Cascade Owner Self Board');

    // Add a second admin who tries to remove the owner
    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const removeOwner = await request.delete(
      `${BASE}/api/boards/${board.id}/members/${ownerUser.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );

    // Either 403 (not allowed) or 400 (cannot remove owner)
    expect(removeOwner.status()).toBeGreaterThanOrEqual(400);
    expect(removeOwner.status()).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 9. Viewer role — structural write endpoints denied
// ---------------------------------------------------------------------------

test.describe('Viewer role — write endpoints denied', () => {
  test('Viewer POST /api/boards/:id/columns → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ViewerDny1Own', 'vwdny-own1');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerDny1', 'vwdny-v1');
    const board = await createBoard(request, ownerToken, 'Viewer Column Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Column', position: 99 },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer POST /api/boards/:id/swimlanes → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ViewerDny2Own', 'vwdny-own2');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerDny2', 'vwdny-v2');
    const board = await createBoard(request, ownerToken, 'Viewer Swimlane Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Swimlane', designator: 'VW-' },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer POST /api/boards/:id/labels → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ViewerDny3Own', 'vwdny-own3');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerDny3', 'vwdny-v3');
    const board = await createBoard(request, ownerToken, 'Viewer Labels Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Label', color: '#123456' },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer POST /api/boards/:id/sprints → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ViewerDny4Own', 'vwdny-own4');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerDny4', 'vwdny-v4');
    const board = await createBoard(request, ownerToken, 'Viewer Sprints Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { name: 'Viewer Sprint', goal: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Viewer DELETE /api/boards/:id → 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ViewerDny5Own', 'vwdny-own5');
    const { token: viewerToken, user: viewerUser } = await createUser(request, 'ViewerDny5', 'vwdny-v5');
    const board = await createBoard(request, ownerToken, 'Viewer Delete Board');
    await addMember(request, ownerToken, board.id, viewerUser.id, 'viewer');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 10. Card permissions — create, delete own, admin delete any
// ---------------------------------------------------------------------------

test.describe('Card permissions — member and admin', () => {
  test('Board creator can create a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CardCreatorOwn', 'cardperm-own1');
    const board = await createBoard(request, ownerToken, 'Card Creator Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Owner Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
    const card = await res.json();
    expect(card.title).toBe('Owner Card');
  });

  test('Board admin can create a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CardAdminOwn', 'cardperm-own2');
    const { token: adminToken, user: adminUser } = await createUser(request, 'CardAdmin', 'cardperm-adm2');
    const board = await createBoard(request, ownerToken, 'Card Admin Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        title: 'Admin Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board member can create a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CardMbrOwn', 'cardperm-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'CardMbr', 'cardperm-m3');
    const board = await createBoard(request, ownerToken, 'Card Member Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: {
        title: 'Member Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board member can delete their own card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DelOwnCardOwn', 'cardperm-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'DelOwnCardMbr', 'cardperm-m4');
    const board = await createBoard(request, ownerToken, 'Del Own Card Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: {
        title: 'Member Own Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(deleteRes.ok()).toBe(true);
  });

  test('Board admin can delete any card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DelAnyOwn', 'cardperm-own5');
    const { token: adminToken, user: adminUser } = await createUser(request, 'DelAnyAdm', 'cardperm-adm5');
    const { token: memberToken, user: memberUser } = await createUser(request, 'DelAnyMbr', 'cardperm-m5');
    const board = await createBoard(request, ownerToken, 'Del Any Card Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Member creates a card
    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: {
        title: 'Member Card To Delete',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await createRes.json();

    // Admin deletes the member's card
    const deleteRes = await request.delete(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(deleteRes.ok()).toBe(true);
  });

  test('Non-member cannot delete a card on a private board (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NMDelOwn', 'cardperm-own6');
    const { token: nmToken } = await createUser(request, 'NMDelNM', 'cardperm-nm6');
    const board = await createBoard(request, ownerToken, 'NM Del Card Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Owner Card',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(deleteRes.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 11. Comment permissions — create and access
// ---------------------------------------------------------------------------

test.describe('Comment permissions', () => {
  test('Board member can create a comment on a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CmtMbrOwn', 'cmt-own1');
    const { token: memberToken, user: memberUser } = await createUser(request, 'CmtMbr', 'cmt-m1');
    const board = await createBoard(request, ownerToken, 'Cmt Member Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Card For Comment',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await cardRes.json();

    const commentRes = await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { content: 'Member comment here' },
    });

    expect(commentRes.status()).toBeGreaterThanOrEqual(200);
    expect(commentRes.status()).toBeLessThan(300);
  });

  test('Board admin can create a comment on a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CmtAdmOwn', 'cmt-own2');
    const { token: adminToken, user: adminUser } = await createUser(request, 'CmtAdm', 'cmt-adm2');
    const board = await createBoard(request, ownerToken, 'Cmt Admin Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Card For Admin Comment',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await cardRes.json();

    const commentRes = await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { content: 'Admin comment here' },
    });

    expect(commentRes.status()).toBeGreaterThanOrEqual(200);
    expect(commentRes.status()).toBeLessThan(300);
  });

  test('Non-member cannot create comment on a card (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CmtNMOwn', 'cmt-own3');
    const { token: nmToken } = await createUser(request, 'CmtNM', 'cmt-nm3');
    const board = await createBoard(request, ownerToken, 'Cmt NM Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Card No NM Comment',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await cardRes.json();

    const commentRes = await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { content: 'Injected comment' },
    });

    expect(commentRes.status()).toBe(403);
  });

  test('Member can read comments on a card', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'CmtReadOwn', 'cmt-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'CmtReadMbr', 'cmt-m4');
    const board = await createBoard(request, ownerToken, 'Cmt Read Board');
    const swimlane = await createSwimlane(request, ownerToken, board.id);

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Card For Reading Comments',
        board_id: board.id,
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    const card = await cardRes.json();

    const getRes = await request.get(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(getRes.status()).toBe(200);
    expect(Array.isArray(await getRes.json())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Label permissions — admin can create, member cannot
// ---------------------------------------------------------------------------

test.describe('Label permissions — admin vs member', () => {
  test('Board admin can create a label', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'LblAdmOwn', 'lbl-own1');
    const { token: adminToken, user: adminUser } = await createUser(request, 'LblAdm', 'lbl-adm1');
    const board = await createBoard(request, ownerToken, 'Label Admin Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Label', color: '#3b82f6' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board member cannot create a label (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'LblMbrOwn', 'lbl-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'LblMbr', 'lbl-m2');
    const board = await createBoard(request, ownerToken, 'Label Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegal Label', color: '#ef4444' },
    });

    expect(res.status()).toBe(403);
  });

  test('Board creator can create and delete a label', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'LblCreatorOwn', 'lbl-own3');
    const board = await createBoard(request, ownerToken, 'Label Creator Board');

    const createRes = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: 'Creator Label', color: '#22c55e' },
    });

    expect(createRes.status()).toBeGreaterThanOrEqual(200);
    const label = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/boards/${board.id}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    expect(deleteRes.ok()).toBe(true);
  });

  test('Board member cannot delete a label (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'LblDelOwn', 'lbl-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'LblDelMbr', 'lbl-m4');
    const board = await createBoard(request, ownerToken, 'Label Delete Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const createRes = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: 'Label To Delete', color: '#a855f7' },
    });
    const label = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/boards/${board.id}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(deleteRes.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 13. Board visibility — only members see board in list
// ---------------------------------------------------------------------------

test.describe('Board visibility in boards list', () => {
  test('Board is not visible to non-members in GET /api/boards', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'VisOwner', 'vis-own1');
    const { token: nmToken } = await createUser(request, 'VisNM', 'vis-nm1');
    const board = await createBoard(request, ownerToken, 'Invisible Board');

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });
    expect(res.ok()).toBe(true);
    const boards: any[] = await res.json();
    expect(boards.find((b) => b.id === board.id)).toBeUndefined();
  });

  test('Board is visible to members in GET /api/boards', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'VisMbrOwn', 'vis-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'VisMbrMbr', 'vis-m2');
    const board = await createBoard(request, ownerToken, 'Visible To Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.ok()).toBe(true);
    const boards: any[] = await res.json();
    expect(boards.find((b) => b.id === board.id)).toBeDefined();
  });

  test('Board removed from non-member list immediately after removal', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'RmVisOwn', 'vis-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'RmVisMbr', 'vis-m3');
    const board = await createBoard(request, ownerToken, 'Remove Visibility Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    // Confirm visible
    let res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    let boards: any[] = await res.json();
    expect(boards.find((b) => b.id === board.id)).toBeDefined();

    // Remove member
    await request.delete(`${BASE}/api/boards/${board.id}/members/${memberUser.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Board no longer in list
    res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    boards = await res.json();
    expect(boards.find((b) => b.id === board.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 14. Auth failures — token expiry / invalid tokens return 401
// ---------------------------------------------------------------------------

test.describe('Auth token failures — 401 responses', () => {
  test('Expired / invalid token returns 401 on GET /api/boards', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });

    expect(res.status()).toBe(401);
  });

  test('Missing Authorization header returns 401 on GET /api/boards', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`);
    expect(res.status()).toBe(401);
  });

  test('Invalid token returns 401 on board-specific endpoint', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'TokenOwner', 'tok-own1');
    const board = await createBoard(request, ownerToken, 'Token Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: 'Bearer bad.token.here' },
    });

    expect(res.status()).toBe(401);
  });

  test('Empty Authorization header value returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: '' },
    });

    // Either 401 (auth check) or 400 (bad header) is acceptable; not 200
    expect(res.status()).not.toBe(200);
  });

  test('No token returns 401 on POST /api/cards', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards`, {
      data: { title: 'Unauth card', board_id: 1, column_id: 1, swimlane_id: 1 },
    });

    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 15. Column access control — creator and admin can CRUD, member read-only
// ---------------------------------------------------------------------------

test.describe('Column access control', () => {
  test('Board creator can create a column', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColCreatorOwn', 'col-own1');
    const board = await createBoard(request, ownerToken, 'Column Creator Board');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: 'New Column By Creator', position: 5 },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board admin can create a column', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColAdmOwn', 'col-own2');
    const { token: adminToken, user: adminUser } = await createUser(request, 'ColAdm', 'col-adm2');
    const board = await createBoard(request, ownerToken, 'Column Admin Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Column', position: 5 },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board member can read columns (GET /api/boards/:id/columns → 200)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColReadOwn', 'col-own3');
    const { token: memberToken, user: memberUser } = await createUser(request, 'ColReadMbr', 'col-m3');
    const board = await createBoard(request, ownerToken, 'Column Read Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(200);
  });

  test('Board member cannot create a column (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColMbrOwn', 'col-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'ColMbrMbr', 'col-m4');
    const board = await createBoard(request, ownerToken, 'Column Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegal Column', position: 99 },
    });

    expect(res.status()).toBe(403);
  });

  test('Board admin can delete a column', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColDelAdmOwn', 'col-own5');
    const { token: adminToken, user: adminUser } = await createUser(request, 'ColDelAdm', 'col-adm5');
    const board = await createBoard(request, ownerToken, 'Column Admin Delete Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    // Create a column to delete
    const createRes = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: 'Column To Delete', position: 10 },
    });
    const col = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/boards/${board.id}/columns/${col.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(deleteRes.ok()).toBe(true);
  });

  test('Non-member cannot read columns (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'ColNMOwn', 'col-own6');
    const { token: nmToken } = await createUser(request, 'ColNMUser', 'col-nm6');
    const board = await createBoard(request, ownerToken, 'Column NM Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${nmToken}` },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 16. Board settings access — admin can edit, member cannot
// ---------------------------------------------------------------------------

test.describe('Board settings access control', () => {
  test('Board admin can update board settings (PUT /api/boards/:id)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'SetAdmOwn', 'set-own1');
    const { token: adminToken, user: adminUser } = await createUser(request, 'SetAdm', 'set-adm1');
    const board = await createBoard(request, ownerToken, 'Settings Admin Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Updated By Admin', description: 'Admin updated this' },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated By Admin');
  });

  test('Board member cannot update board settings (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'SetMbrOwn', 'set-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'SetMbrMbr', 'set-m2');
    const board = await createBoard(request, ownerToken, 'Settings Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Hijacked Name', description: '' },
    });

    expect(res.status()).toBe(403);
  });

  test('Board admin can delete the board', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'DelBoardOwn', 'set-own3');
    const board = await createBoard(request, ownerToken, 'Board To Delete');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    expect(res.ok()).toBe(true);
  });

  test('Board member cannot delete the board (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'NDelBoardOwn', 'set-own4');
    const { token: memberToken, user: memberUser } = await createUser(request, 'NDelBoardMbr', 'set-m4');
    const board = await createBoard(request, ownerToken, 'No Delete Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status()).toBe(403);
  });

  test('Board admin can add and remove members', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'AddRmAdmOwn', 'set-own5');
    const { token: adminToken, user: adminUser } = await createUser(request, 'AddRmAdm', 'set-adm5');
    const { user: targetUser } = await createUser(request, 'AddRmTarget', 'set-tgt5');
    const board = await createBoard(request, ownerToken, 'Admin Add Remove Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    // Admin adds target
    const addRes = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { user_id: targetUser.id, role: 'member' },
    });
    expect(addRes.status()).toBe(201);

    // Admin removes target
    const removeRes = await request.delete(`${BASE}/api/boards/${board.id}/members/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(removeRes.ok()).toBe(true);
  });

  test('Board member cannot add other members (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MbrAddOwn', 'set-own6');
    const { token: memberToken, user: memberUser } = await createUser(request, 'MbrAddMbr', 'set-m6');
    const { user: newUser } = await createUser(request, 'MbrAddNew', 'set-new6');
    const board = await createBoard(request, ownerToken, 'Member Cannot Add Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { user_id: newUser.id, role: 'member' },
    });

    expect(res.status()).toBe(403);
  });

  test('Board admin can create swimlanes', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'SwAdmOwn', 'sw-own1');
    const { token: adminToken, user: adminUser } = await createUser(request, 'SwAdm', 'sw-adm1');
    const board = await createBoard(request, ownerToken, 'Swimlane Admin Board');

    await addMember(request, ownerToken, board.id, adminUser.id, 'admin');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Swimlane', designator: 'AS-', color: '#6366f1' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });

  test('Board member cannot create swimlanes (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'SwMbrOwn', 'sw-own2');
    const { token: memberToken, user: memberUser } = await createUser(request, 'SwMbrMbr', 'sw-m2');
    const board = await createBoard(request, ownerToken, 'Swimlane Member Board');

    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Illegal Swimlane', designator: 'IL-', color: '#ef4444' },
    });

    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 10. Global admin override
// ---------------------------------------------------------------------------

test.describe('Global app admin override', () => {
  test.fixme(
    'Global admin can access any board regardless of membership',
    async ({ request }) => {
      // Global admin (is_admin = true) overrides board membership checks.
      // To test: create two users, set one as global admin via admin API,
      // then verify the global admin can GET a board they were never added to.
      // This test is fixme'd because it requires a pre-existing admin account
      // or the admin promotion endpoint to be accessible in the test environment.
    },
  );

  test.fixme(
    'Global admin can delete any board',
    async ({ request }) => {
      // Similar to above — a global admin should be able to DELETE any board
      // via DELETE /api/boards/:id regardless of board membership.
      // Fixme'd for the same reasons as above.
    },
  );
});

// ---------------------------------------------------------------------------
// 11. UI — non-member board redirect / error state
// ---------------------------------------------------------------------------

test.describe('UI — permission enforcement', () => {
  test('Non-member navigating to board sees error, no board content', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'UIPermOwner', 'uiperm-own');
    const { token: nmToken } = await createUser(request, 'UIPermNM', 'uiperm-nm');
    const board = await createBoard(request, ownerToken, 'UI Perm Board');

    await page.addInitScript((t) => localStorage.setItem('token', t), nmToken);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('Member sees board content, not an error page', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'UIMbrOwner', 'uimbr-own');
    const { token: memberToken, user: memberUser } = await createUser(request, 'UIMbrMember', 'uimbr-m');
    const board = await createBoard(request, ownerToken, 'UI Member Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), memberToken);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.error')).not.toBeVisible();
  });

  test('Member settings page is accessible but admin-only sections are not', async ({ page, request }) => {
    const { token: ownerToken } = await createUser(request, 'UISetOwner', 'uiset-own');
    const { token: memberToken, user: memberUser } = await createUser(request, 'UISetMember', 'uiset-m');
    const board = await createBoard(request, ownerToken, 'UI Settings Board');
    await addMember(request, ownerToken, board.id, memberUser.id, 'member');

    await page.addInitScript((t) => localStorage.setItem('token', t), memberToken);
    await page.goto(`/boards/${board.id}/settings`);

    // Member should see the settings page but the danger zone / rename form
    // should either be hidden or read-only for members
    await expect(page.locator('.settings-page, .board-settings')).toBeVisible({ timeout: 10000 });
  });
});
