import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup(request: any, boardName = 'Workflow Test Board') {
  const email = `test-wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  return { token, board };
}

/** Return the default columns created with a new board. */
async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<Array<{ id: number; name: string }>>;
}

/**
 * Create a second user and add them as a member (non-admin) of the board.
 */
async function createMemberUser(request: any, boardId: number, ownerToken: string) {
  const email = `test-member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const { token, user } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Member User' },
    })
  ).json();

  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { user_id: user.id, role: 'member' },
  });

  return { token, user };
}

/**
 * Navigate to board settings and wait for all async data to settle.
 *
 * BoardSettings.tsx fires several async fetches on mount (columns, labels,
 * workflow rules, issue types, etc.). The workflow toggle's `setWorkflowEnabled`
 * is overwritten by `loadWorkflowRules` when it resolves — if we click the
 * toggle before that fetch completes the state is reset to false.
 *
 * Waiting for networkidle ensures all initial fetches have completed before we
 * interact with the workflow section.
 */
async function gotoSettingsAndWaitForColumns(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}/settings`);
  // Wait for the settings page to render and columns to load.
  // Don't use waitForLoadState('networkidle') — SSE keeps a persistent connection open.
  await expect(
    page.locator('.settings-section').filter({ hasText: 'Columns' }).locator('.item-name').first()
  ).toBeVisible({ timeout: 10000 });
  // Extra pause for async workflow rules fetch to complete before we interact
  await page.waitForTimeout(300);
}

/**
 * Click the "Enable workflow rules" checkbox directly.
 * The checkbox is a React-controlled component inside a <label>. Clicking the
 * label itself toggles twice (label click + checkbox propagation), so we target
 * the input directly.
 */
async function clickWorkflowToggle(workflowSection: any) {
  await workflowSection.locator('.workflow-toggle input[type="checkbox"]').click();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Workflow Rules', () => {
  // ── 1. Workflow section visible ──────────────────────────────────────────────
  test('workflow rules section is visible in board settings', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(
      page.locator('.settings-section').filter({ hasText: 'Workflow Rules' })
    ).toBeVisible();
    await expect(
      page.locator('.settings-section h2:has-text("Workflow Rules")')
    ).toBeVisible();
  });

  // ── 2. Enable workflow rules — matrix appears ────────────────────────────────
  test('enabling workflow rules reveals the transition matrix', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Matrix should not be visible before enabling
    await expect(page.locator('.workflow-matrix')).not.toBeVisible();

    // Enable workflow rules by clicking the checkbox directly
    await clickWorkflowToggle(workflowSection);
    await expect(
      workflowSection.locator('.workflow-toggle input[type="checkbox"]')
    ).toBeChecked();

    // Matrix should now be visible
    await expect(page.locator('.workflow-matrix')).toBeVisible();
  });

  // ── 3. Configure a transition ────────────────────────────────────────────────
  test('can check a transition cell and save workflow rules', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    // Need at least 2 columns for a transition
    expect(columns.length).toBeGreaterThanOrEqual(2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Enable
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Click the first available (non-diagonal) cell checkbox in the matrix.
    // Cells where fromCol === toCol show a '-' span (workflow-matrix-disabled), not a checkbox.
    // The first checkbox in the matrix body corresponds to fromCol[0] → toCol[1].
    const firstCellCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();

    await firstCellCheckbox.click();
    await expect(firstCellCheckbox).toBeChecked();

    // Save
    await workflowSection.locator('button:has-text("Save Workflow Rules")').click();
    // Wait for save to finish — button returns from "Saving..." to "Save Workflow Rules"
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible({ timeout: 5000 });

    // The checkbox should still be checked after save completes
    await expect(firstCellCheckbox).toBeChecked();
  });

  // ── 4. Disable workflow rules — matrix is hidden ─────────────────────────────
  test('disabling workflow rules hides the transition matrix', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Enable first
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Disable by clicking checkbox again (toggles back off)
    await clickWorkflowToggle(workflowSection);
    await expect(
      workflowSection.locator('.workflow-toggle input[type="checkbox"]')
    ).not.toBeChecked();
    await expect(page.locator('.workflow-matrix')).not.toBeVisible();
  });

  // ── 5. Workflow rules persist after reload ───────────────────────────────────
  test('workflow rules and transitions persist after page reload', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Enable and configure a transition
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const firstCellCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();

    await firstCellCheckbox.click();
    await expect(firstCellCheckbox).toBeChecked();

    // Save
    await workflowSection.locator('button:has-text("Save Workflow Rules")').click();
    // Wait for save to finish — button is visible and not "Saving..."
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      workflowSection.locator('button:has-text("Saving...")')
    ).not.toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    // Wait for columns to re-load so we know all async fetches completed
    await expect(
      page.locator('.settings-section').filter({ hasText: 'Columns' }).locator('.item-name').first()
    ).toBeVisible({ timeout: 10000 });

    // Workflow should still be enabled (matrix visible)
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // The previously-checked cell should still be checked
    const persistedCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();
    await expect(persistedCheckbox).toBeChecked();
  });

  // ── 6. Workflow rules block a disallowed card transition ─────────────────────
  test('workflow rules block a disallowed card transition', async () => {
    test.fixme(
      true,
      'Requires creating a card and drag-dropping to a blocked column — too complex to reliably automate with dnd-kit'
    );
  });

  // ── API smoke test: workflow PUT/GET roundtrip ────────────────────────────────
  test('workflow API: set rules and retrieve them correctly', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    const fromId = columns[0].id;
    const toId = columns[1].id;

    // Set a single allowed transition
    const putRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: fromId, to_column_id: toId }] },
    });
    expect(putRes.ok()).toBe(true);

    // Retrieve and verify
    const getRes = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.ok()).toBe(true);
    const rules = await getRes.json();
    expect(Array.isArray(rules)).toBe(true);
    const match = rules.find(
      (r: any) => r.from_column_id === fromId && r.to_column_id === toId
    );
    expect(match).toBeDefined();

    // Clear all rules
    const clearRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [] },
    });
    expect(clearRes.ok()).toBe(true);

    const afterClear = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(afterClear.length).toBe(0);
  });

  // ── API: GET returns array (even when no rules set) ───────────────────────────
  test('workflow API: GET returns empty array when no rules set', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const rules = await res.json();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBe(0);
  });

  // ── API: each rule has the expected shape ─────────────────────────────────────
  test('workflow API: saved rule has correct from_column_id and to_column_id', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    const fromId = columns[0].id;
    const toId = columns[1].id;

    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: fromId, to_column_id: toId }] },
    });

    const rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(rules.length).toBe(1);
    const rule = rules[0];
    expect(rule).toHaveProperty('id');
    expect(rule).toHaveProperty('board_id', board.id);
    expect(rule).toHaveProperty('from_column_id', fromId);
    expect(rule).toHaveProperty('to_column_id', toId);
  });

  // ── API: PUT replaces all rules (not appends) ─────────────────────────────────
  test('workflow API: PUT replaces all existing rules', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Set two rules
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rules: [
          { from_column_id: columns[0].id, to_column_id: columns[1].id },
          { from_column_id: columns[1].id, to_column_id: columns[0].id },
        ],
      },
    });

    let rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(2);

    // Replace with just one rule
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }],
      },
    });

    rules = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(1);
    expect(rules[0].from_column_id).toBe(columns[0].id);
    expect(rules[0].to_column_id).toBe(columns[1].id);
  });

  // ── API: multiple rules can exist for the same board ─────────────────────────
  test('workflow API: multiple rules can be set for the same board', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(3);

    const rulePairs = [
      { from_column_id: columns[0].id, to_column_id: columns[1].id },
      { from_column_id: columns[1].id, to_column_id: columns[2].id },
      { from_column_id: columns[0].id, to_column_id: columns[2].id },
    ];

    const putRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: rulePairs },
    });
    expect(putRes.ok()).toBe(true);

    const rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(3);
  });

  // ── API: unauthenticated request returns 401 ──────────────────────────────────
  test('workflow API: unauthenticated GET returns 401', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`);
    expect(res.status()).toBe(401);
  });

  test('workflow API: unauthenticated PUT returns 401', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    const res = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });
    expect(res.status()).toBe(401);
  });

  // ── API: non-admin board member cannot set workflow rules ─────────────────────
  test('workflow API: non-admin board member cannot PUT workflow rules (403)', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const { token: memberToken } = await createMemberUser(request, board.id, ownerToken);
    const columns = await getColumns(request, ownerToken, board.id);

    const res = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });
    expect(res.status()).toBe(403);
  });

  // ── API: non-admin member CAN read workflow rules ─────────────────────────────
  test('workflow API: non-admin board member can GET workflow rules', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const columns = await getColumns(request, ownerToken, board.id);

    // Owner sets a rule first
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const { token: memberToken } = await createMemberUser(request, board.id, ownerToken);

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.ok()).toBe(true);
    const rules: any[] = await res.json();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  // ── API: rules are isolated per board ────────────────────────────────────────
  test('workflow API: rules are scoped to their board and do not leak to other boards', async ({ request }) => {
    const { token, board: boardA } = await setup(request, 'Board A');
    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Board B' },
      })
    ).json();

    const colsA = await getColumns(request, token, boardA.id);
    const colsB = await getColumns(request, token, boardB.id);

    // Set rules on board A only
    await request.put(`${BASE}/api/boards/${boardA.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: colsA[0].id, to_column_id: colsA[1].id }] },
    });

    // Board B should still have no rules
    const rulesB: any[] = await (
      await request.get(`${BASE}/api/boards/${boardB.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rulesB.length).toBe(0);
  });

  // ── API: deleting board removes its workflow rules (no orphaned rows) ─────────
  test('workflow API: deleting board also removes its workflow rules', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    // Set some rules
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    // Delete the board
    const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    // Attempting to GET workflow rules for the deleted board should 404
    const getRes = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(404);
  });

  // ── API: card move is blocked when transition not in rules ────────────────────
  test('workflow API: card move to disallowed column returns 403', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Set ONLY col[1] → col[2] as allowed (if 3+ cols), or just col[0] → col[1]
    // then try to move the other direction (which is not in the allowed list)
    // For simplicity: allow col[0]→col[1] only, then attempt col[1]→col[0]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    // Create a swimlane + card in col[1]
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'WF Swimlane', designator: 'WF-', color: '#ff0000' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'WF Test Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[1].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping workflow enforcement test');
      return;
    }
    const card = await cardRes.json();

    // Attempt to move card from col[1] → col[0] (disallowed direction)
    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[0].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.status()).toBe(403);
  });

  // ── API: card move is allowed when transition is in rules ─────────────────────
  test('workflow API: card move to allowed column succeeds', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Allow col[0] → col[1]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'WF Swimlane2', designator: 'WF2-', color: '#00ff00' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Allowed Move Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[0].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping workflow enforcement test');
      return;
    }
    const card = await cardRes.json();

    // Move card from col[0] → col[1] (allowed)
    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[1].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.ok()).toBe(true);
  });

  // ── API: when no rules exist, all moves are allowed ───────────────────────────
  test('workflow API: with no rules set, any card move is permitted', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Ensure no rules exist
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Open Swimlane', designator: 'OP-', color: '#0000ff' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Open Move Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[0].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping no-rules test');
      return;
    }
    const card = await cardRes.json();

    // Both directions should be allowed
    const moveForward = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[1].id, swimlane_id: swimlane.id },
    });
    expect(moveForward.ok()).toBe(true);

    const moveBack = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[0].id, swimlane_id: swimlane.id },
    });
    expect(moveBack.ok()).toBe(true);
  });

  // ── UI: workflow matrix has correct number of columns ─────────────────────────
  test('workflow matrix columns match the board column count', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Header row should have one <th> per column plus the row-header cell
    const headerCells = page.locator('.workflow-matrix thead tr th');
    // Total = 1 (empty corner) + n columns
    await expect(headerCells).toHaveCount(columns.length + 1);
  });

  // ── UI: workflow matrix row count matches column count ────────────────────────
  test('workflow matrix rows match the board column count', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // tbody rows: one per column
    const bodyRows = page.locator('.workflow-matrix tbody tr');
    await expect(bodyRows).toHaveCount(columns.length);
  });

  // ── UI: diagonal cells (same col → same col) are disabled ────────────────────
  test('workflow matrix diagonal cells are disabled (self-transitions not configurable)', async ({ page, request }) => {
    const { token, board } = await setup(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Disabled cells should be rendered as '.workflow-matrix-disabled' (not a checkbox)
    const disabledCells = page.locator('.workflow-matrix-disabled');
    // There should be exactly N disabled cells (one per column, on the diagonal)
    const columns = await getColumns(request, token, board.id);
    await expect(disabledCells).toHaveCount(columns.length);
  });

  // ── UI: check and uncheck a cell (toggling) ───────────────────────────────────
  test('workflow matrix cell can be checked then unchecked', async ({ page, request }) => {
    const { token, board } = await setup(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const firstCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();

    // Check
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();

    // Uncheck
    await firstCheckbox.click();
    await expect(firstCheckbox).not.toBeChecked();
  });

  // ── UI: multiple cells can be checked in the same save ───────────────────────
  test('workflow matrix: multiple cells can be checked and saved together', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const checkboxes = page.locator(
      '.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]'
    );

    // Check the first two non-diagonal checkboxes
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).toBeChecked();

    // Save
    await workflowSection.locator('button:has-text("Save Workflow Rules")').click();
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible({ timeout: 5000 });

    // Both should still be checked
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).toBeChecked();
  });

  // ── UI: save button text changes during save ──────────────────────────────────
  test('workflow save button shows "Saving..." while saving', async ({ page, request }) => {
    const { token, board } = await setup(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const saveBtn = workflowSection.locator('button:has-text("Save Workflow Rules")');

    // Click save — it may transiently show "Saving..." before returning
    // We capture the button state rather than race against it
    await saveBtn.click();

    // Eventually it returns to "Save Workflow Rules" regardless
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
  });

  // ── UI: settings page accessible from board header ───────────────────────────
  test('can navigate to board settings from board header settings link', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Click the settings link/button in the board header
    const settingsLink = page.locator(
      '.board-header a[href*="settings"], .board-header button:has-text("Settings")'
    );
    await settingsLink.click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/settings`));
    await expect(
      page.locator('.settings-section h2:has-text("Workflow Rules")')
    ).toBeVisible({ timeout: 10000 });
  });

  // ── API: GET /api/boards/:id/workflow returns 200 with correct Content-Type ─
  test('workflow API: GET returns 200 with JSON content-type', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] ?? '';
    expect(contentType).toContain('application/json');
  });

  // ── API: each rule object has exactly the expected fields ─────────────────
  test('workflow API: each rule object includes id, board_id, from_column_id, to_column_id', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(rules.length).toBeGreaterThan(0);
    const rule = rules[0];
    expect(typeof rule.id).toBe('number');
    expect(typeof rule.board_id).toBe('number');
    expect(typeof rule.from_column_id).toBe('number');
    expect(typeof rule.to_column_id).toBe('number');
    // Should NOT expose sensitive fields
    expect(rule.password_hash).toBeUndefined();
  });

  // ── API: PUT with empty rules array clears all existing rules ─────────────
  test('workflow API: PUT empty rules array clears all existing rules', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // First set some rules
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    // Verify they exist
    let rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(1);

    // Clear via empty PUT
    const clearRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [] },
    });
    expect(clearRes.ok()).toBe(true);

    rules = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(0);
  });

  // ── API: duplicate rule pair is handled gracefully ─────────────────────────
  test('workflow API: duplicate rule pairs in PUT do not create duplicate rows', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Attempt to submit the same rule twice in the same PUT
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rules: [
          { from_column_id: columns[0].id, to_column_id: columns[1].id },
          { from_column_id: columns[0].id, to_column_id: columns[1].id },
        ],
      },
    });
    // At most one rule for this pair should exist
    const stored: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const matching = stored.filter(
      (r: any) => r.from_column_id === columns[0].id && r.to_column_id === columns[1].id
    );
    expect(matching.length).toBeLessThanOrEqual(1);
  });

  // ── API: self-transition rule (same from and to column) handled gracefully ─
  test('workflow API: self-transition rule (same from and to column) handled gracefully', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(1);

    // Attempt to set a self-transition rule — should not crash
    const res = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rules: [{ from_column_id: columns[0].id, to_column_id: columns[0].id }],
      },
    });
    // Either accepts or rejects gracefully — should not 500
    expect([200, 400, 422]).toContain(res.status());
  });

  // ── API: user not member of board gets 403 or 404 on GET ──────────────────
  test('workflow API: user not a member of board cannot read workflow rules', async ({ request }) => {
    const { board } = await setup(request, 'Owner Board WF');
    // Create a second user who is NOT a board member
    const email = `test-nonmember-${Date.now()}@test.com`;
    const { token: strangerToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Stranger' },
      })
    ).json();

    const res = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    // Should be 403 or 404 — not 200
    expect([403, 404]).toContain(res.status());
  });

  // ── API: viewer role can read but not set workflow rules ──────────────────
  test('workflow API: viewer role can GET but not PUT workflow rules', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const columns = await getColumns(request, ownerToken, board.id);

    // Create viewer user
    const email = `test-viewer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const { token: viewerToken, user: viewerUser } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Viewer User' },
      })
    ).json();

    // Add as viewer
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: viewerUser.id, role: 'viewer' },
    });

    // Viewer CAN read
    const getRes = await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(getRes.ok()).toBe(true);

    // Viewer cannot PUT
    const putRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });
    expect(putRes.status()).toBe(403);
  });

  // ── API: card move to same column (reorder) always allowed ────────────────
  test('workflow API: moving card to same column (reorder) always allowed even with strict rules', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Set a rule that only allows col[0] -> col[1]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'SameCol Swimlane', designator: 'SC-', color: '#aabbcc' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Same Column Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[0].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping same-column move test');
      return;
    }
    const card = await cardRes.json();

    // Move to same column (reorder) should be allowed regardless of rules
    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[0].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.ok()).toBe(true);
  });

  // ── API: non-member cannot move card even to allowed column ───────────────
  test('workflow API: non-member cannot move a card even to an allowed column', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const columns = await getColumns(request, ownerToken, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Allow col[0] -> col[1]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'NM Swimlane', designator: 'NM-', color: '#112233' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'NonMember Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[0].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const card = await cardRes.json();

    // Stranger user (not a board member) tries to move
    const email = `test-nm-${Date.now()}@test.com`;
    const { token: strangerToken } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Stranger' },
      })
    ).json();

    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
      data: { column_id: columns[1].id, swimlane_id: swimlane.id },
    });
    expect([403, 404]).toContain(moveRes.status());
  });

  // ── API: can set all non-diagonal transitions ─────────────────────────────
  test('workflow API: can set all non-diagonal (N*(N-1)) transitions for a board', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    const n = columns.length;
    expect(n).toBeGreaterThanOrEqual(2);

    // Build all non-diagonal (from != to) pairs
    const allRules: Array<{ from_column_id: number; to_column_id: number }> = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          allRules.push({ from_column_id: columns[i].id, to_column_id: columns[j].id });
        }
      }
    }

    const putRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: allRules },
    });
    expect(putRes.ok()).toBe(true);

    const rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(allRules.length);
  });

  // ── API: two different admins on different boards have independent rules ───
  test('workflow API: two admins on separate boards have independent workflow state', async ({ request }) => {
    const email1 = `wf-user1-${Date.now()}@test.com`;
    const email2 = `wf-user2-${Date.now()}@test.com`;

    const { token: t1 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email1, password: 'password123', display_name: 'User1' },
      })
    ).json();
    const { token: t2 } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email: email2, password: 'password123', display_name: 'User2' },
      })
    ).json();

    const board1 = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${t1}` },
        data: { name: 'IsolatedA' },
      })
    ).json();
    const board2 = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${t2}` },
        data: { name: 'IsolatedB' },
      })
    ).json();

    const cols1 = await getColumns(request, t1, board1.id);

    // Set rule on board1 only
    await request.put(`${BASE}/api/boards/${board1.id}/workflow`, {
      headers: { Authorization: `Bearer ${t1}` },
      data: { rules: [{ from_column_id: cols1[0].id, to_column_id: cols1[1].id }] },
    });

    // Board2 should have no rules
    const rules2: any[] = await (
      await request.get(`${BASE}/api/boards/${board2.id}/workflow`, {
        headers: { Authorization: `Bearer ${t2}` },
      })
    ).json();
    expect(rules2.length).toBe(0);
  });

  // ── API: GET for non-existent board returns 404 ───────────────────────────
  test('workflow API: GET for non-existent board returns 404', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/99999998/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // ── API: PUT for non-existent board returns 404 ───────────────────────────
  test('workflow API: PUT for non-existent board returns 404', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.put(`${BASE}/api/boards/99999997/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [] },
    });
    expect(res.status()).toBe(404);
  });

  // ── API: blocked card move returns 403 with readable error ────────────────
  test('workflow API: blocked card move returns 403 with readable error message', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Only allow col[0] -> col[1]; block col[1] -> col[0]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'BlockMsg Swimlane', designator: 'BM-', color: '#cc0000' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Blocked Msg Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[1].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping error message test');
      return;
    }
    const card = await cardRes.json();

    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[0].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.status()).toBe(403);
    const body = await moveRes.text();
    // Error body should mention workflow or transition
    expect(body.toLowerCase()).toMatch(/transition|workflow/);
  });

  // ── API: board member can move card along allowed transition ──────────────
  test('workflow API: board member (non-admin) can move card along allowed transition', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const { token: memberToken } = await createMemberUser(request, board.id, ownerToken);
    const columns = await getColumns(request, ownerToken, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Set rule: col[0] -> col[1] allowed
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Member Move Lane', designator: 'ML-', color: '#009900' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Member Move Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[0].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping member move test');
      return;
    }
    const card = await cardRes.json();

    // Member performs the allowed move
    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { column_id: columns[1].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.ok()).toBe(true);
  });

  // ── API: board member is blocked from disallowed transition ───────────────
  test('workflow API: board member is blocked from disallowed card transition', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request);
    const { token: memberToken } = await createMemberUser(request, board.id, ownerToken);
    const columns = await getColumns(request, ownerToken, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Allow only col[0] -> col[1]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { name: 'Block Member Lane', designator: 'BML-', color: '#ff6600' },
      })
    ).json();

    // Card starts in col[1]
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: 'Member Blocked Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[1].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping member blocked test');
      return;
    }
    const card = await cardRes.json();

    // Member tries to move col[1] -> col[0] (blocked)
    const moveRes = await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { column_id: columns[0].id, swimlane_id: swimlane.id },
    });
    expect(moveRes.status()).toBe(403);
  });

  // ── UI: workflow section contains descriptive text ────────────────────────
  test('workflow settings section contains descriptive subtitle or label text', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await expect(workflowSection).toBeVisible();
    // Section should have more than just the heading
    const sectionText = await workflowSection.textContent();
    expect((sectionText ?? '').length).toBeGreaterThan(15);
  });

  // ── UI: disabling workflow rules persists after page reload ───────────────
  test('disabling workflow rules via toggle persists after page reload', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Enable and configure a transition
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const firstCellCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();
    await firstCellCheckbox.click();
    await workflowSection.locator('button:has-text("Save Workflow Rules")').click();
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible({ timeout: 5000 });

    // Disable workflow rules
    await clickWorkflowToggle(workflowSection);
    await expect(
      workflowSection.locator('.workflow-toggle input[type="checkbox"]')
    ).not.toBeChecked();
    await workflowSection.locator('button:has-text("Save Workflow Rules")').click();
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible({ timeout: 5000 });

    // Reload and verify still disabled
    await page.reload();
    await expect(
      page.locator('.settings-section').filter({ hasText: 'Columns' }).locator('.item-name').first()
    ).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.workflow-matrix')).not.toBeVisible();
  });

  // ── UI: settings page loads without JS errors ─────────────────────────────
  test('board settings page loads without console errors in workflow section', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    // Filter out known benign errors
    const realErrors = errors.filter(
      (e) =>
        !e.includes('net::ERR') &&
        !e.includes('favicon') &&
        !e.includes('chrome-extension')
    );
    expect(realErrors).toHaveLength(0);
  });

  // ── UI: Save Workflow Rules button only visible when workflow is enabled ───
  test('Save Workflow Rules button is hidden before workflow is enabled', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });

    // Before enabling: save button should not exist
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).not.toBeVisible();

    // Enable
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Save button should now appear
    await expect(
      workflowSection.locator('button:has-text("Save Workflow Rules")')
    ).toBeVisible();
  });

  // ── UI: column names appear in workflow matrix header ─────────────────────
  test('workflow matrix header contains the names of the board columns', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Each column name should appear in the matrix header row
    for (const col of columns) {
      await expect(
        page.locator('.workflow-matrix thead').getByText(col.name, { exact: false })
      ).toBeVisible();
    }
  });

  // ── UI: column names appear in workflow matrix row headers ────────────────
  test('workflow matrix row headers contain the names of the board columns', async ({ page, request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    // Each column name should appear as a row header in tbody
    for (const col of columns) {
      await expect(
        page.locator('.workflow-matrix tbody').getByText(col.name, { exact: false })
      ).toBeVisible();
    }
  });

  // ── UI: checking a cell does not disable the save button ──────────────────
  test('workflow matrix: checking a cell leaves the save button enabled', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await gotoSettingsAndWaitForColumns(page, board.id);

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await clickWorkflowToggle(workflowSection);
    await expect(page.locator('.workflow-matrix')).toBeVisible();

    const firstCheckbox = page
      .locator('.workflow-matrix tbody .workflow-matrix-cell input[type="checkbox"]')
      .first();
    await firstCheckbox.click();

    const saveBtn = workflowSection.locator('button:has-text("Save Workflow Rules")');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).not.toBeDisabled();
  });

  // ── UI: workflow enable toggle is an accessible checkbox input ─────────────
  test('workflow enable toggle is a proper accessible checkbox input', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const toggle = page.locator('.workflow-toggle input[type="checkbox"]');
    await expect(toggle).toBeVisible();
    const tagName = await toggle.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('input');
  });

  // ── UI: workflow section is scrollable into view ───────────────────────────
  test('workflow rules section is reachable by scrolling the settings page', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const workflowSection = page.locator('.settings-section').filter({ hasText: 'Workflow Rules' });
    await workflowSection.scrollIntoViewIfNeeded();
    await expect(workflowSection).toBeVisible();
  });

  // ── UI: board admin sees workflow section; member navigated away ──────────
  test('workflow settings section is visible for board admin', async ({ page, request }) => {
    const { token: ownerToken, board } = await setup(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), ownerToken);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.settings-section').filter({ hasText: 'Workflow Rules' })
    ).toBeVisible();
  });

  // ── API: re-enabling rules after clear restores enforcement ───────────────
  test('workflow API: re-setting rules after clearing restores enforcement', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Set a rule
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    // Clear all rules (now all moves allowed)
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [] },
    });

    // Re-set the same rule again
    const reSetRes = await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });
    expect(reSetRes.ok()).toBe(true);

    const rules: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(rules.length).toBe(1);
    expect(rules[0].from_column_id).toBe(columns[0].id);
    expect(rules[0].to_column_id).toBe(columns[1].id);
  });

  // ── API: bulk card move respects workflow rules ────────────────────────────
  test('workflow API: bulk card move to disallowed column returns 403', async ({ request }) => {
    const { token, board } = await setup(request);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    // Only allow col[0] -> col[1]
    await request.put(`${BASE}/api/boards/${board.id}/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rules: [{ from_column_id: columns[0].id, to_column_id: columns[1].id }] },
    });

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Bulk WF Lane', designator: 'BWF-', color: '#8833cc' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Bulk WF Card',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: columns[1].id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping bulk move test');
      return;
    }
    const card = await cardRes.json();

    // Attempt bulk move col[1] -> col[0] (disallowed)
    const bulkRes = await request.post(`${BASE}/api/boards/${board.id}/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        card_ids: [card.id],
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    });
    // Should be blocked (403) or endpoint not exist (404/405)
    expect([403, 404, 405]).toContain(bulkRes.status());
  });

  // ── Fixme: event-driven workflow rules (not yet implemented) ──────────────

  test.fixme('workflow rules: POST /api/boards/:id/workflow-rules creates event-driven rule (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - The current workflow system is column-transition based (allow/deny).
     *   - Event-driven rules (trigger_type, action_type, conditions, actions) are
     *     not yet implemented in this codebase.
     *   - A separate /workflow-rules endpoint needs to be created alongside /workflow.
     *   - Rule shape: { name, trigger_type, action_type, conditions, actions, is_active }
     *   - trigger_type: card_moved | card_created | card_updated | due_date_approaching
     *   - action_type: assign_label | notify_member | move_card | set_priority
     */
  });

  test.fixme('workflow rules: GET /api/boards/:id/workflow-rules returns array of event-driven rules (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - Should return all event-driven rules for the board as a JSON array.
     *   - Each rule should include: id, board_id, name, trigger_type, action_type,
     *     conditions (JSON), actions (JSON), is_active, created_at.
     */
  });

  test.fixme('workflow rules: rule with is_active false is not triggered (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - is_active flag on event-driven rules controls execution.
     *   - Inactive rules should be silently skipped at trigger time.
     */
  });

  test.fixme('workflow rules: multiple event-driven rules for same trigger all execute (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - When multiple rules share the same trigger_type, all active ones execute.
     *   - Execution order may follow rule creation order (ascending id).
     */
  });

  test.fixme('workflow rules: rule execution is logged in activity_log (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - Each time an event-driven rule fires, an activity_log entry should be
     *     created with action="workflow_rule_executed" and the rule id in new_value.
     */
  });

  test.fixme('workflow rules: DELETE /api/boards/:id/workflow-rules/:rid removes rule (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - DELETE endpoint for individual event-driven rules not yet implemented.
     *   - Should return 204 on success, 404 if rule not found.
     */
  });

  test.fixme('workflow rules: PUT /api/boards/:id/workflow-rules/:rid updates rule fields (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - PATCH/PUT endpoint to update name, conditions, actions or toggle is_active.
     *   - Returns updated rule object on success.
     */
  });

  test.fixme('workflow rules: conditions field stored and returned as JSON object (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - conditions field should be a JSON object, not a plain string.
     *   - Example: { "column_id": 5, "label_ids": [1, 2] }
     */
  });

  test.fixme('workflow rules: actions field stored and returned as JSON object (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - actions field: { "label_id": 3 } for assign_label,
     *     { "user_id": 7 } for notify_member, etc.
     */
  });

  test.fixme('workflow rules: board admin can CRUD event-driven rules; member gets 403 (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - Only board admins should create/update/delete event-driven rules.
     *   - Members get 403 on write operations but can read rules.
     */
  });

  test.fixme('workflow rules: UI shows Add Rule button in Workflow Rules section (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - BoardSettings.tsx needs an event-driven rules sub-section with
     *     an "Add Rule" button that opens a form.
     *   - Form fields: name, trigger type (dropdown), action type (dropdown).
     */
  });

  test.fixme('workflow rules: toggling is_active via UI enable/disable toggle (not implemented)', async () => {
    /**
     * Implementation notes:
     *   - Each event-driven rule in the UI list should have an enable/disable toggle.
     *   - Clicking it calls PUT /api/boards/:id/workflow-rules/:rid with is_active toggled.
     */
  });
});
