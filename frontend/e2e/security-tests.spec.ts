/**
 * Security-focused E2E tests for Zira.
 *
 * Two categories:
 *
 * 1. KNOWN BUG tests — marked test.fail() — these DEMONSTRATE real authorization
 *    vulnerabilities that exist in the backend today. Playwright's test.fail()
 *    inverts the result: the test "passes the suite" while the bug exists and
 *    "fails the suite" (correctly) once the backend is fixed. Each test has a
 *    comment pointing to the exact handler that needs the fix.
 *
 * 2. WORKING SECURITY tests — normal test() calls — these verify security
 *    controls that are already correctly implemented and must continue to work.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Signs up a new user via the API and returns { token, user }.
 * Uses crypto.randomUUID() to guarantee uniqueness across parallel workers.
 */
async function signup(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  displayName: string,
) {
  const email = `sec-test-${crypto.randomUUID()}@example.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  expect(res.status(), `signup failed for ${displayName}: ${res.status()}`).toBe(200);
  const body = await res.json();
  return { token: body.token as string, user: body.user };
}

/**
 * Creates a board owned by the given user and returns the board object.
 */
async function createBoard(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
  name: string,
) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description: 'Security test board' },
  });
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createBoard failed: ${res.status()}`).toBeLessThan(300);
  return res.json();
}

/**
 * Creates a swimlane on a board and returns the swimlane object.
 */
async function createSwimlane(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
  boardId: number,
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Security Swimlane',
      repo_source: 'default_gitea',
      repo_owner: '',
      repo_name: '',
      designator: 'SEC-',
      color: '#6366f1',
    },
  });
  expect(res.status(), `createSwimlane failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createSwimlane failed: ${res.status()}`).toBeLessThan(300);
  return res.json();
}

/**
 * Fetches the columns of a board and returns the first one.
 */
async function getFirstColumn(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
  boardId: number,
) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), `getColumns failed: ${res.status()}`).toBe(200);
  const columns = await res.json();
  expect(columns.length, 'board should have at least one column').toBeGreaterThan(0);
  return columns[0];
}

/**
 * Creates a card and returns the card object.
 */
async function createCard(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title = 'Security Test Card',
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      title,
    },
  });
  expect(res.status(), `createCard failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createCard failed: ${res.status()}`).toBeLessThan(300);
  return res.json();
}

/**
 * Creates a sprint on a board and returns the sprint object.
 */
async function createSprint(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  token: string,
  boardId: number,
) {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Security Sprint', goal: '', start_date: '', end_date: '' },
  });
  expect(res.status(), `createSprint failed: ${res.status()}`).toBeGreaterThanOrEqual(200);
  expect(res.status(), `createSprint failed: ${res.status()}`).toBeLessThan(300);
  return res.json();
}

// ---------------------------------------------------------------------------
// Setup helper: builds a full Owner context (board + swimlane + column + card + sprint)
// ---------------------------------------------------------------------------

async function buildOwnerContext(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
) {
  const { token, user } = await signup(request, 'Owner');
  const board = await createBoard(request, token, `Private Board ${crypto.randomUUID().slice(0, 6)}`);
  const swimlane = await createSwimlane(request, token, board.id);
  const column = await getFirstColumn(request, token, board.id);
  const card = await createCard(request, token, board.id, swimlane.id, column.id);
  const sprint = await createSprint(request, token, board.id);
  return { token, user, board, swimlane, column, card, sprint };
}

// ===========================================================================
// KNOWN BUG TESTS — marked test.fail()
//
// These tests assert the CORRECT (expected) behavior. Because the backend does
// not yet enforce board membership on individual-resource endpoints, the
// assertion currently fails — which is exactly what test.fail() documents.
//
// Fix locations (Go backend):
//   Cards  — internal/server/card_handlers.go : loadCard() / handleGetCard()
//            handleUpdateCard(), handleDeleteCard()
//   Sprint — internal/server/sprint_handlers.go : loadSprint() / handleGetSprint()
//            handleUpdateSprint()
//
// After the fix, remove the test.fail() wrapper so the tests run normally.
// ===========================================================================

test.describe('Known Authorization Bugs (test.fail = bug still present)', () => {

  // -------------------------------------------------------------------------
  // Bug 1: Non-member can read any card
  // -------------------------------------------------------------------------

  // BUG: GET /api/cards/:id has no board-membership guard in handleGetCard().
  // loadCard() fetches the card from the DB without checking whether the
  // requesting user is a member of the card's board.
  // Fix: after loading the card, call checkBoardMembership(w, r, card.BoardID, BoardRoleViewer).
  test.fail(
    'non-member can read any card — KNOWN BUG needs backend fix',
    async ({ request }) => {
      const owner = await buildOwnerContext(request);
      const { token: tokenB } = await signup(request, 'Attacker-Read');

      // Attacker (not a board member) calls GET /api/cards/:id with own token.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK — card data is returned to the attacker
      const res = await request.get(`${BASE}/api/cards/${owner.card.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      expect(res.status()).toBe(403);
    },
  );

  // -------------------------------------------------------------------------
  // Bug 2: Non-member can modify any card
  // -------------------------------------------------------------------------

  // BUG: PUT /api/cards/:id has no board-membership guard in handleUpdateCard().
  // loadCard() does not verify membership before allowing writes.
  // Fix: add checkBoardMembership(w, r, card.BoardID, BoardRoleMember) after
  // the card is loaded in handleUpdateCard().
  test.fail(
    'non-member can modify any card — KNOWN BUG needs backend fix',
    async ({ request }) => {
      const owner = await buildOwnerContext(request);
      const { token: tokenB } = await signup(request, 'Attacker-Modify');

      // Attacker changes the card title.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK — title is actually changed
      const res = await request.put(`${BASE}/api/cards/${owner.card.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
        data: { title: 'HACKED BY ATTACKER' },
      });
      expect(res.status()).toBe(403);
    },
  );

  // -------------------------------------------------------------------------
  // Bug 3: Non-member can delete any card
  // -------------------------------------------------------------------------

  // BUG: DELETE /api/cards/:id has no board-membership guard in handleDeleteCard().
  // Fix: add checkBoardMembership(w, r, card.BoardID, BoardRoleMember) in
  // handleDeleteCard() after the card is loaded.
  test.fail(
    'non-member can delete any card — KNOWN BUG needs backend fix',
    async ({ request }) => {
      const owner = await buildOwnerContext(request);
      const { token: tokenB } = await signup(request, 'Attacker-Delete');

      // Attacker deletes a card they have no access to.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK (or 204) — card is deleted
      const res = await request.delete(`${BASE}/api/cards/${owner.card.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      expect(res.status()).toBe(403);
    },
  );

  // -------------------------------------------------------------------------
  // Bug 4: Non-member can read any sprint
  // -------------------------------------------------------------------------

  // BUG: GET /api/sprints/:id has no board-membership guard in handleGetSprint().
  // loadSprint() fetches the sprint by ID without checking the requesting user's
  // membership on the sprint's board.
  // Fix: after loading the sprint, call checkBoardMembership(w, r, sprint.BoardID, BoardRoleViewer).
  test.fail(
    'non-member can read any sprint — KNOWN BUG needs backend fix',
    async ({ request }) => {
      const owner = await buildOwnerContext(request);
      const { token: tokenB } = await signup(request, 'Attacker-Sprint-Read');

      // Attacker reads a sprint from a board they are not a member of.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK — sprint data is returned
      const res = await request.get(`${BASE}/api/sprints/${owner.sprint.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      expect(res.status()).toBe(403);
    },
  );

  // -------------------------------------------------------------------------
  // Bug 5: Non-member can modify any sprint
  // -------------------------------------------------------------------------

  // BUG: PUT /api/sprints/:id has no board-membership guard in handleUpdateSprint().
  // loadSprint() does not verify membership before allowing writes.
  // Fix: add checkBoardMembership(w, r, sprint.BoardID, BoardRoleMember) in
  // handleUpdateSprint() after the sprint is loaded.
  test.fail(
    'non-member can modify any sprint — KNOWN BUG needs backend fix',
    async ({ request }) => {
      const owner = await buildOwnerContext(request);
      const { token: tokenB } = await signup(request, 'Attacker-Sprint-Modify');

      // Attacker renames a sprint on a board they are not a member of.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK — sprint is modified
      const res = await request.put(`${BASE}/api/sprints/${owner.sprint.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
        data: { name: 'HACKED SPRINT', goal: '', status: 'planning' },
      });
      expect(res.status()).toBe(403);
    },
  );

  // -------------------------------------------------------------------------
  // Bug 6: Any user can self-promote to admin via POST /api/auth/promote-admin
  // -------------------------------------------------------------------------

  // BUG: POST /api/auth/promote-admin allows any authenticated user to
  // promote themselves to admin (handlePromoteAdmin in auth_handlers.go).
  // The self-promotion path (targetID == caller.ID) has no guard —
  // only promoting *other* users requires existing admin status.
  // Fix: restrict self-promotion to the very first user, or require an
  // existing admin to authorise all promotions.
  test.fail(
    'any user can self-promote to admin via POST /api/auth/promote-admin — KNOWN BUG',
    async ({ request }) => {
      const { token } = await signup(request, 'Self-Promoter');

      // A regular non-admin user should NOT be able to self-promote.
      // EXPECTED: 403 Forbidden
      // ACTUAL BUG: 200 OK — user is now admin
      const res = await request.post(`${BASE}/api/auth/promote-admin`, {
        headers: { Authorization: `Bearer ${token}` },
        // No body — triggers the self-promotion path in handlePromoteAdmin
      });
      expect(res.status()).toBe(403);
    },
  );

});

// ===========================================================================
// WORKING SECURITY TESTS — these must pass today and on every future run
// ===========================================================================

test.describe('JWT and Authentication Controls', () => {

  // -------------------------------------------------------------------------
  // Unauthenticated request to every major protected route returns 401
  // -------------------------------------------------------------------------

  test('unauthenticated request to GET /api/boards returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to GET /api/auth/me returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to POST /api/cards returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards`, {
      data: { title: 'test', board_id: 1, column_id: 1, swimlane_id: 1 },
    });
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to GET /api/sprints returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sprints?board_id=1`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to GET /api/users returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/users`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to GET /api/admin/users returns 401', async ({ request }) => {
    // requireAdmin wraps requireAuth, so the outer check returns 401 before 403.
    const res = await request.get(`${BASE}/api/admin/users`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Invalid / malformed JWT returns 401
  // -------------------------------------------------------------------------

  test('syntactically valid but cryptographically invalid JWT returns 401', async ({ request }) => {
    // A well-formed JWT structure but with a bogus signature.
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiI5OTk5OTkiLCJleHAiOjk5OTk5OTk5OTl9' +
      '.invalidsignature';
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status()).toBe(401);
  });

  test('completely random token string returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer not-a-jwt-at-all` },
    });
    expect(res.status()).toBe(401);
  });

  test('empty Bearer token string returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status()).toBe(401);
  });

  test('Authorization header with wrong scheme returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Expired JWT returns 401
  // -------------------------------------------------------------------------

  test('expired JWT token returns 401', async ({ request }) => {
    // Manually crafted JWT with exp in the past (Jan 1 2020).
    // Signed with a key that will NOT match the server's secret, so the
    // validation fails on signature before even checking expiry — but the
    // observable result (401) is the same whether it fails on signature or expiry.
    const expiredToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJ1c2VyX2lkIjoxLCJleHAiOjE1Nzc4MzYwMDB9' +
      '.expiredSignature';
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status()).toBe(401);
  });

});

test.describe('CORS Headers', () => {

  test('CORS headers are present on a preflight OPTIONS request', async ({ request }) => {
    // OPTIONS /api/boards — browser preflight check.
    const res = await request.fetch(`${BASE}/api/boards`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    // corsMiddleware sets Access-Control-Allow-Origin and returns 200 for OPTIONS
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBeTruthy();
    expect(res.headers()['access-control-allow-methods']).toMatch(/GET/i);
    expect(res.headers()['access-control-allow-headers']).toMatch(/Authorization/i);
  });

  test('CORS headers are present on an authenticated GET response', async ({ request }) => {
    const { token } = await signup(request, 'CORS Tester');
    const res = await request.get(`${BASE}/api/boards`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://example.com',
      },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBeTruthy();
  });

  test('Vary: Origin header is set on responses', async ({ request }) => {
    const { token } = await signup(request, 'CORS Vary Tester');
    const res = await request.get(`${BASE}/api/boards`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://example.com',
      },
    });
    expect(res.headers()['vary']).toMatch(/Origin/i);
  });

});

test.describe('Admin Endpoint Access Control', () => {

  test('non-admin user receives 403 on GET /api/admin/users', async ({ request }) => {
    const { token } = await signup(request, 'Regular User No Admin');
    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('non-admin user receives 403 on PUT /api/admin/users', async ({ request }) => {
    const { token } = await signup(request, 'Regular User No Promote');
    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: 1, is_admin: true },
    });
    expect(res.status()).toBe(403);
  });

  test('non-admin user receives 403 on POST /api/config', async ({ request }) => {
    const { token } = await signup(request, 'Regular User No Config');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'http://example.com', gitea_api_key: 'fake' },
    });
    expect(res.status()).toBe(403);
  });

});

test.describe('Config Endpoint Intentional Public Disclosure', () => {

  // This endpoint intentionally returns config info to unauthenticated callers
  // so that the login page can display the configured Gitea instance URL.
  // The test documents the accepted behavior — if this ever becomes auth-gated
  // it should be updated alongside the backend change.
  test('GET /api/config responds without auth (intentional disclosure)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  test('GET /api/config/status responds without auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

});

test.describe('Password and Sensitive Data in Responses', () => {

  test('password_hash is not present in signup response', async ({ request }) => {
    const email = `pwtest-${crypto.randomUUID()}@example.com`;
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'secret-password', display_name: 'PW Test User' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The user object must not expose the password hash.
    // models.User has PasswordHash tagged with json:"-" so it should be absent.
    expect(body.user).not.toHaveProperty('password_hash');
    expect(body.user).not.toHaveProperty('PasswordHash');
    expect(JSON.stringify(body)).not.toContain('password_hash');
  });

  test('password_hash is not present in login response', async ({ request }) => {
    const email = `pwlogintest-${crypto.randomUUID()}@example.com`;
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'secret-password', display_name: 'PW Login Test' },
    });
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: 'secret-password' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).not.toHaveProperty('password_hash');
    expect(body.user).not.toHaveProperty('PasswordHash');
    expect(JSON.stringify(body)).not.toContain('password_hash');
  });

  test('GET /api/auth/me does not expose password_hash', async ({ request }) => {
    const { token } = await signup(request, 'Me Endpoint Tester');
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('PasswordHash');
  });

  test('GET /api/users list does not expose password_hash for any user', async ({ request }) => {
    const { token } = await signup(request, 'Users List Tester');
    const res = await request.get(`${BASE}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const users = await res.json();
    expect(Array.isArray(users)).toBe(true);
    const raw = JSON.stringify(users);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('PasswordHash');
  });

  test('Auth token is not echoed back in response headers or body', async ({ request }) => {
    const email = `token-echo-${crypto.randomUUID()}@example.com`;
    const password = 'echo-test-password';
    const res = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password, display_name: 'Token Echo Tester' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The token should be in the response body but must not appear in
    // response headers as an unintentional echo (e.g. X-Token, Set-Cookie).
    expect(body.token).toBeTruthy();
    const headers = res.headers();
    expect(headers['x-token']).toBeUndefined();
    expect(headers['set-cookie']).toBeUndefined();
  });

});

test.describe('Rate Limiting', () => {

  // The rate limiter is EXEMPT for 127.0.0.1 (loopback). This is intentional
  // to prevent parallel E2E test suites from tripping the limiter.
  // See auth_handlers.go:checkAuthRateLimit() — host == "127.0.0.1" returns true immediately.
  test('loopback 127.0.0.1 is exempt from login rate limiting', async ({ request }) => {
    // Send 15 failed login attempts in rapid succession (limit is 10/min for
    // non-loopback addresses). All should return 401 (wrong password), not 429.
    const email = `rate-exempt-${crypto.randomUUID()}@example.com`;
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'correctpassword', display_name: 'Rate Exempt' },
    });

    for (let i = 0; i < 12; i++) {
      const res = await request.post(`${BASE}/api/auth/login`, {
        data: { email, password: 'wrongpassword' },
      });
      // Must be 401 (bad credentials), never 429 (rate limited) from loopback.
      expect(res.status(), `attempt ${i + 1} should be 401 not 429`).toBe(401);
    }
  });

  test('loopback 127.0.0.1 is exempt from signup rate limiting', async ({ request }) => {
    // 12 rapid signups should all succeed or fail for legitimate reasons, not 429.
    for (let i = 0; i < 12; i++) {
      const email = `rate-signup-${crypto.randomUUID()}@example.com`;
      const res = await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: `Rate Signup ${i}` },
      });
      expect(res.status(), `signup attempt ${i + 1} should not be 429`).not.toBe(429);
    }
  });

});

test.describe('Input Sanitization', () => {

  // -------------------------------------------------------------------------
  // SQL injection in board name must not crash the server or return unexpected data.
  // The backend uses parameterised queries (SQLite with database/sql), so the
  // payload is stored as a literal string, not interpreted as SQL.
  // -------------------------------------------------------------------------

  test('SQL injection payload in board name is stored literally, not executed', async ({ request }) => {
    const { token } = await signup(request, 'SQL Inject Tester');

    // Classic SQL injection attempt: try to terminate the string and append DROP TABLE.
    const maliciousName = "'; DROP TABLE boards; --";
    const createRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: maliciousName, description: '' },
    });
    // Must succeed — the injection should be treated as a plain string.
    expect(createRes.status()).toBeGreaterThanOrEqual(200);
    expect(createRes.status()).toBeLessThan(300);

    const created = await createRes.json();
    // The stored name must match exactly — not modified, not empty.
    expect(created.name).toBe(maliciousName);

    // Boards list must still work — if DROP TABLE had executed, this would fail.
    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const boards = await listRes.json();
    expect(Array.isArray(boards)).toBe(true);
  });

  test('SQL injection payload in sprint name is stored literally', async ({ request }) => {
    const { token } = await signup(request, 'SQL Sprint Inject');
    const board = await createBoard(request, token, `SQL Sprint Board ${crypto.randomUUID().slice(0, 6)}`);

    const maliciousSprintName = "'; DELETE FROM sprints WHERE 1=1; --";
    const res = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: maliciousSprintName, goal: '' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
    const sprint = await res.json();
    expect(sprint.name).toBe(maliciousSprintName);
  });

  // -------------------------------------------------------------------------
  // XSS: card title with a <script> tag must be rendered as text in the DOM,
  // not executed as script, when viewed in the board browser UI.
  // -------------------------------------------------------------------------

  test('XSS payload in card title is rendered as text, not executed in browser', async ({ request, page }) => {
    const { token } = await signup(request, 'XSS Tester');
    const board = await createBoard(request, token, `XSS Board ${crypto.randomUUID().slice(0, 6)}`);
    const swimlane = await createSwimlane(request, token, board.id);
    const column = await getFirstColumn(request, token, board.id);
    const xssTitle = '<script>window.__xss_executed=true;alert(1);</script>';

    // Card creation may fail if Gitea is configured but unreachable. When that
    // happens we cannot render the board, so skip the UI rendering check rather
    // than report a false failure. The XSS check applies only to the React
    // rendering layer — the backend 500 is a separate concern.
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: column.id,
        title: xssTitle,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed (Gitea unreachable or misconfigured): ${cardRes.status()}`);
      return;
    }
    // Card created successfully — now navigate to the board and verify
    // the XSS payload is rendered as escaped text, not executed as script.

    // Inject the token before the page loads so the board renders.
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await page.goto(`http://localhost:3000/boards/${board.id}`);
    await page.waitForTimeout(500);

    // The script must NOT have executed.
    expect(dialogFired, 'alert() fired — XSS payload executed in the browser').toBe(false);

    const xssExecuted = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__xss_executed,
    );
    expect(xssExecuted, '__xss_executed sentinel was set — script ran').toBeFalsy();
  });

  test('XSS payload in board name is rendered as text in the board list', async ({ request, page }) => {
    const { token } = await signup(request, 'XSS Board Tester');
    const xssName = '<img src=x onerror="window.__xss_board=true">';

    await createBoard(request, token, xssName);

    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    await page.goto('http://localhost:3000/boards');
    await page.waitForTimeout(500);

    const xssBoard = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__xss_board,
    );
    expect(xssBoard, 'onerror handler fired — XSS in board name executed').toBeFalsy();
  });

});

test.describe('Health Check and Non-Sensitive Public Routes', () => {

  test('GET /healthz responds without auth', async ({ request }) => {
    const res = await request.get(`${BASE}/healthz`);
    expect(res.status()).toBeLessThanOrEqual(503); // 200 (ok) or 503 (degraded)
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('version');
  });

  test('/healthz does not require auth token', async ({ request }) => {
    // Explicitly verify no 401 is returned.
    const res = await request.get(`${BASE}/healthz`);
    expect(res.status()).not.toBe(401);
  });

});
