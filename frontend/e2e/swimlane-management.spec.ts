import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  boardId: number;
  columns: Array<{ id: number; name: string; state: string }>;
}

async function setupUserAndBoard(request: any, boardName = 'Swimlane Test Board'): Promise<SetupResult> {
  const email = `swimlane-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Swimlane Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  // Fetch board detail to get default columns
  const detailRes = await request.get(`${BASE}/api/boards/${board.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailRes.json();
  const columns = detail.columns || [];

  return { token, boardId: board.id, columns };
}

async function createSwimlane(
  request: any,
  token: string,
  boardId: number,
  name: string,
  designator: string,
  color = '#6366f1',
  label = '',
): Promise<{ id: number; name: string; designator: string; color: string }> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator, color, label },
  });
  return res.json();
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
): Promise<{ id: number; title: string }> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      sprint_id: null,
      title,
      description: '',
      priority: 'medium',
    },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Swimlane Management', () => {
  // ── 1. Create first swimlane via board settings ──────────────────────────

  test('create first swimlane via board settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection).toBeVisible();

    // Open the Add Swimlane modal
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    // Fill required fields
    await page.locator('.modal input[placeholder="Frontend"]').fill('Team Alpha');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('my-org/alpha-repo');
    await page.locator('.modal input[placeholder="FE-"]').fill('TA-');

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

    // Modal closes and swimlane appears in the list
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(swimlanesSection.locator('.item-name:has-text("Team Alpha")')).toBeVisible();
  });

  // ── 2. Create second swimlane — two sections on board ───────────────────

  test('two swimlanes render as separate sections on the board', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);

    // Create two swimlanes via API
    await createSwimlane(request, token, boardId, 'Frontend', 'FE-');
    await createSwimlane(request, token, boardId, 'Backend', 'BE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // Switch to "All Cards" view so the board renders without needing an active sprint
    await page.locator('.view-btn:has-text("All Cards")').click();

    // Both swimlane gutters should be present
    const gutters = page.locator('.swimlane-gutter');
    await expect(gutters).toHaveCount(2, { timeout: 8000 });
  });

  // ── 3. Swimlane header shows designator ─────────────────────────────────

  test('swimlane header shows designator in settings list', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Mobile Team', 'MOB-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    // Settings shows designator in item-meta
    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Mobile Team' });
    await expect(row.locator('.item-meta')).toContainText('MOB-');
  });

  // ── 4. Swimlane header shows name ───────────────────────────────────────

  test('swimlane label shows full name on board', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Platform Engineering', 'PE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.locator('.view-btn:has-text("All Cards")').click();

    // The .swimlane-name inside the gutter should display the full name
    await expect(page.locator('.swimlane-name:has-text("Platform Engineering")')).toBeVisible({ timeout: 8000 });
  });

  // ── 5. Delete swimlane ───────────────────────────────────────────────────

  test('delete swimlane via board settings removes it from the list', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Temp Lane', 'TMP-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Temp Lane' });
    await expect(row).toBeVisible();

    // Accept the confirm dialog and click delete
    page.once('dialog', (dialog) => dialog.accept());
    await row.locator('.item-delete').click();

    // Swimlane should be gone from the list
    await expect(swimlanesSection.locator('.item-name:has-text("Temp Lane")')).not.toBeVisible();
  });

  // ── 6. Swimlane with cards cannot delete (or warns) ─────────────────────

  test('deleting swimlane with cards shows confirmation dialog', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const swimlane = await createSwimlane(request, token, boardId, 'Busy Lane', 'BL-');
    const columnId = columns[0]?.id;
    if (columnId) {
      await createCard(request, token, boardId, swimlane.id, columnId, 'Card in Busy Lane');
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Busy Lane' });
    await expect(row).toBeVisible();

    // Track whether a dialog appears when delete is clicked
    let dialogSeen = false;
    page.once('dialog', (dialog) => {
      dialogSeen = true;
      // Dismiss to leave the swimlane intact and verify the warning was shown
      dialog.dismiss().catch(() => {});
    });

    await row.locator('.item-delete').click();

    // A confirmation dialog must appear warning about card deletion
    await page.waitForTimeout(500);
    expect(dialogSeen).toBe(true);

    // After dismissing, the swimlane should still be in the list
    await expect(swimlanesSection.locator('.item-name:has-text("Busy Lane")')).toBeVisible();
  });

  // ── 7. Card count per swimlane ───────────────────────────────────────────

  test('collapsed swimlane shows card count when sprint is active', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const swimlane = await createSwimlane(request, token, boardId, 'Count Lane', 'CL-');
    const columnId = columns[0]?.id;

    // Create a sprint and assign cards to it so they appear in board view
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Count Sprint' },
    });
    const sprint = await sprintRes.json();

    // Create two cards
    if (columnId) {
      const card1 = await createCard(request, token, boardId, swimlane.id, columnId, 'Count Card 1');
      const card2 = await createCard(request, token, boardId, swimlane.id, columnId, 'Count Card 2');

      // Assign cards to sprint
      await request.post(`${BASE}/api/cards/${card1.id}/assign-sprint`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { sprint_id: sprint.id },
      });
      await request.post(`${BASE}/api/cards/${card2.id}/assign-sprint`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { sprint_id: sprint.id },
      });

      // Start the sprint
      await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // The board view should now show the active sprint cards
    // Click the swimlane gutter to collapse it — collapsed state shows card count
    const gutterEl = page.locator('.swimlane-gutter').first();
    await expect(gutterEl).toBeVisible({ timeout: 8000 });
    await gutterEl.click();

    // When collapsed the count chip should appear
    await expect(page.locator('.swimlane-card-count')).toContainText('2', { timeout: 5000 });
  });

  // ── 8. Swimlane reorder (DnD unreliable in Playwright) ──────────────────

  test.fixme('swimlane reorder via drag-and-drop', async ({ page, request }) => {
    // @dnd-kit drag-and-drop is unreliable in Playwright — skipping.
    // To test reorder: use the POST /api/boards/:id/swimlanes/:swimlaneId/reorder endpoint
    // and verify board reflects new order on next load.
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'First', 'F1-');
    await createSwimlane(request, token, boardId, 'Second', 'F2-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();

    const gutters = page.locator('.swimlane-gutter');
    await expect(gutters).toHaveCount(2);

    // Drag first swimlane ribbon below the second
    const firstRibbon = page.locator('.swimlane-ribbon').first();
    const secondRibbon = page.locator('.swimlane-ribbon').nth(1);
    await firstRibbon.dragTo(secondRibbon);

    // Verify order swapped
    await expect(page.locator('.swimlane-name').first()).toHaveText('Second');
  });

  // ── 9. Swimlane credentials (API token field) ────────────────────────────

  test('swimlane credentials: api_token field is accepted by the backend', async ({ request }) => {
    // This tests the API directly since credential fields only matter for
    // non-default Gitea sources. The AddSwimlaneModal does not expose
    // api_token in the UI for default_gitea source.
    const { token, boardId } = await setupUserAndBoard(request);

    const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Cred Lane',
        designator: 'CR-',
        color: '#ec4899',
        repo_source: 'custom_gitea',
        repo_url: 'https://git.example.com',
        repo_owner: 'acme',
        repo_name: 'project',
        api_token: 'super-secret-token',
      },
    });
    // Backend stores credentials when repo_source is not default_gitea and api_token is provided
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe('Cred Lane');
  });

  // ── 10. Multiple swimlanes on board — 3 lanes, 2 cards each ─────────────

  test('three swimlanes each with two cards render correctly on board', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const columnId = columns[0]?.id;

    const laneA = await createSwimlane(request, token, boardId, 'Lane A', 'LA-', '#6366f1');
    const laneB = await createSwimlane(request, token, boardId, 'Lane B', 'LB-', '#22c55e');
    const laneC = await createSwimlane(request, token, boardId, 'Lane C', 'LC-', '#f97316');

    if (columnId) {
      for (const lane of [laneA, laneB, laneC]) {
        await createCard(request, token, boardId, lane.id, columnId, `${lane.name} Card 1`);
        await createCard(request, token, boardId, lane.id, columnId, `${lane.name} Card 2`);
      }
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();

    // All three swimlane sections should be present
    await expect(page.locator('.swimlane')).toHaveCount(3, { timeout: 8000 });

    // Verify each swimlane name is visible in the gutter
    await expect(page.locator('.swimlane-name:has-text("Lane A")')).toBeVisible();
    await expect(page.locator('.swimlane-name:has-text("Lane B")')).toBeVisible();
    await expect(page.locator('.swimlane-name:has-text("Lane C")')).toBeVisible();

    // At least 6 cards should be rendered (2 per lane × 3 lanes)
    await expect(page.locator('.card-item')).toHaveCount(6, { timeout: 8000 });
  });

  // ── 11. Swimlane color ───────────────────────────────────────────────────

  test('swimlane color is reflected in settings list and board ribbon', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const pink = '#ec4899';
    await createSwimlane(request, token, boardId, 'Pink Lane', 'PK-', pink);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    // Verify color swatch in settings
    await page.goto(`/boards/${boardId}/settings`);
    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Pink Lane' });
    const colorSwatch = row.locator('.item-color');
    await expect(colorSwatch).toBeVisible();
    // The inline style should contain the hex color
    const style = await colorSwatch.getAttribute('style');
    expect(style).toContain(pink);

    // Verify color ribbon on board
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();
    const ribbon = page.locator('.swimlane-ribbon').first();
    await expect(ribbon).toBeVisible({ timeout: 8000 });
    const ribbonStyle = await ribbon.getAttribute('style');
    expect(ribbonStyle).toContain(pink);
  });

  // ── Bonus: change swimlane color via color picker in Add Swimlane modal ──

  test('selecting a different color in Add Swimlane modal saves that color', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    // Fill required fields
    await page.locator('.modal input[placeholder="Frontend"]').fill('Green Lane');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('org/repo');
    await page.locator('.modal input[placeholder="FE-"]').fill('GR-');

    // Pick the green color (#22c55e is index 6 in the colors array)
    const colorOptions = page.locator('.modal .color-option');
    await colorOptions.nth(6).click();

    // The selected button should have the "selected" class
    await expect(colorOptions.nth(6)).toHaveClass(/selected/);

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    // Swimlane appears in list
    await expect(swimlanesSection.locator('.item-name:has-text("Green Lane")')).toBeVisible();

    // The color swatch should reflect the chosen green
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Green Lane' });
    const swatchStyle = await row.locator('.item-color').getAttribute('style');
    expect(swatchStyle).toContain('#22c55e');
  });

  // ── Empty state: no swimlanes ─────────────────────────────────────────────

  test('board with no swimlanes shows empty-swimlanes prompt', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-swimlanes p')).toContainText('Add a swimlane');
  });

  // ── Settings shows "No swimlanes configured" when list is empty ───────────

  test('settings shows empty list message when no swimlanes exist', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);
    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.empty-list')).toContainText('No swimlanes configured');
  });

  // ── Swimlane filter on board ──────────────────────────────────────────────

  test('swimlane filter dropdown lists created swimlanes', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Alpha', 'AL-');
    await createSwimlane(request, token, boardId, 'Beta', 'BE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // Expand filters
    await page.locator('.filter-toggle-btn').click();
    await expect(page.locator('.filters-expanded')).toBeVisible();

    // Swimlane filter select should contain both swimlane names
    const swimlaneSelect = page.locator('.filters-expanded .filter-select').first();
    await expect(swimlaneSelect.locator('option:has-text("Alpha")')).toHaveCount(1);
    await expect(swimlaneSelect.locator('option:has-text("Beta")')).toHaveCount(1);
  });
});
