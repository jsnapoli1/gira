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
  // Signup must succeed — if it fails the test setup is broken, not the SUT.
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
  // Fix: same as Bug 1 — add checkBoardMembership(w, r, card.BoardID, BoardRoleMember)
  // after the card is loaded in handleUpdateCard().
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

});

// ===========================================================================
// WORKING SECURITY TESTS — these must pass today and on every future run
// ===========================================================================

test.describe('Working Security Controls', () => {

  // -------------------------------------------------------------------------
  // 6. Unauthenticated request to protected endpoint returns 401
  // -------------------------------------------------------------------------

  test('unauthenticated request to GET /api/boards returns 401', async ({ request }) => {
    // Call the boards list endpoint with no Authorization header at all.
    const res = await request.get(`${BASE}/api/boards`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 7. Invalid / malformed JWT returns 401
  // -------------------------------------------------------------------------

  test('invalid JWT token returns 401 on protected endpoint', async ({ request }) => {
    // A syntactically valid-looking but cryptographically invalid JWT.
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTkiLCJleHAiOjk5OTk5OTk5OTl9.invalidsignature';
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 8. Non-admin cannot access the admin user-management endpoint
  // -------------------------------------------------------------------------

  test('non-admin user receives 403 on PUT /api/admin/users', async ({ request }) => {
    const { token } = await signup(request, 'Regular User');

    // A freshly-signed-up user is never an admin by default.
    // The PUT /api/admin/users route is guarded by requireAdmin middleware.
    const res = await request.put(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: 1, is_admin: true },
    });
    expect(res.status()).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 9. Config endpoint leaks Gitea URL without authentication (intentional)
  //    — Document this as an accepted information-disclosure decision so that
  //    any future accidental change to require auth is caught.
  // -------------------------------------------------------------------------

  test('GET /api/config returns a response without auth (intentional disclosure)', async ({ request }) => {
    // This endpoint intentionally returns config info to unauthenticated callers
    // so that the login page can display the configured Gitea instance URL.
    // The test documents the current behaviour; if this endpoint ever needs to
    // be auth-gated the test should be updated alongside the backend change.
    const res = await request.get(`${BASE}/api/config`);

    // Must respond (not 401 / 404 / 500) — exact status may be 200 or similar.
    expect(res.status()).toBeLessThan(400);

    // Response must be valid JSON (even if an empty object when unconfigured).
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  // -------------------------------------------------------------------------
  // 10. Self-promotion to admin is possible for any authenticated user
  //     — Document this as a security concern (any user can call
  //       POST /api/auth/promote-admin with no user_id and become admin).
  //
  //     This test DOCUMENTS the current behavior so the team is aware.
  //     The backend allows self-promotion unconditionally (no "first user only"
  //     restriction). The test uses test.fail() to signal this is a bug:
  //     calling POST /api/auth/promote-admin as a regular non-admin user
  //     SHOULD return 403 but currently returns 200.
  // -------------------------------------------------------------------------

  // BUG: POST /api/auth/promote-admin allows any authenticated user to
  // promote themselves to admin (handlePromoteAdmin in auth_handlers.go,
  // lines ~150-195). The self-promotion path (targetID == caller.ID) has
  // no guard — only promoting *other* users requires existing admin status.
  // Fix: restrict self-promotion to the very first user, or require an
  // existing admin to authorise all promotions.
  test.fail(
    'any user can self-promote to admin via POST /api/auth/promote-admin — KNOWN BUG',
    async ({ request }) => {
      const { token, user } = await signup(request, 'Self-Promoter');

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

  // -------------------------------------------------------------------------
  // 11. XSS in card title — script tag must not execute in the browser
  // -------------------------------------------------------------------------

  test('XSS payload in card title is rendered as text, not executed', async ({ request, page }) => {
    // --- Setup via API ---
    const { token } = await signup(request, 'XSS Tester');
    const board = await createBoard(request, token, `XSS Board ${crypto.randomUUID().slice(0, 6)}`);
    const swimlane = await createSwimlane(request, token, board.id);
    const column = await getFirstColumn(request, token, board.id);
    const xssTitle = '<script>window.__xss_executed=true;alert(1);</script>';

    await createCard(request, token, board.id, swimlane.id, column.id, xssTitle);

    // --- Navigate to the board in a real browser ---
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    // Intercept any dialog (alert / confirm / prompt) — if one fires the XSS ran.
    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await page.goto(`http://localhost:3000/boards/${board.id}`);

    // Give any inline script a moment to execute if it were going to.
    await page.waitForTimeout(500);

    // The script must NOT have executed.
    expect(dialogFired, 'alert() fired — XSS payload was executed in the browser').toBe(false);

    // Also verify via JS that the global sentinel was not set.
    const xssExecuted = await page.evaluate(() => (window as unknown as Record<string, unknown>).__xss_executed);
    expect(xssExecuted, '__xss_executed sentinel was set — script ran').toBeFalsy();
  });

});
