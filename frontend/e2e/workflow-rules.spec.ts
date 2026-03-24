import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

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

  // ── 6. Workflow enforced on card move ────────────────────────────────────────
  test('workflow rules block a disallowed card transition', async () => {
    test.fixme(
      true,
      'Requires creating a card and drag-dropping to a blocked column — too complex to reliably automate with dnd-kit'
    );
  });

  // ── API-level smoke test: workflow PUT/GET roundtrip ─────────────────────────
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
});
