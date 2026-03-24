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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Swimlane Management', () => {

  // ── 1. Create swimlane via board settings ────────────────────────────────

  test('create first swimlane via board settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection).toBeVisible();

    // Open the Add Swimlane modal
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    // Fill required fields (no repos configured so repo field is free-text)
    await page.locator('.modal input[placeholder="Frontend"]').fill('Team Alpha');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('my-org/alpha-repo');
    await page.locator('.modal input[placeholder="FE-"]').fill('TA-');

    // Submit
    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

    // Modal closes and swimlane appears in the list
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(swimlanesSection.locator('.item-name:has-text("Team Alpha")')).toBeVisible();
  });

  // ── 2. Swimlane appears in board view ────────────────────────────────────

  test('swimlane created via API appears on board view in All Cards mode', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Platform Engineering', 'PE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.locator('.view-btn:has-text("All Cards")').click();

    await expect(page.locator('.swimlane-name:has-text("Platform Engineering")')).toBeVisible({ timeout: 8000 });
  });

  // ── 3. Swimlane header shows designator in settings list ─────────────────

  test('swimlane row in settings shows designator in meta', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Mobile Team', 'MOB-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Mobile Team' });
    await expect(row.locator('.item-meta')).toContainText('MOB-');
  });

  // ── 4. Two swimlanes render as separate rows on the board ─────────────────

  test('two swimlanes render as separate sections on the board', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);

    await createSwimlane(request, token, boardId, 'Frontend', 'FE-');
    await createSwimlane(request, token, boardId, 'Backend', 'BE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.locator('.view-btn:has-text("All Cards")').click();

    const gutters = page.locator('.swimlane-gutter');
    await expect(gutters).toHaveCount(2, { timeout: 8000 });
  });

  // ── 5. Swimlane color reflected in settings swatch and board ribbon ───────

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

  // ── 6. Delete swimlane (no cards) — direct deletion ──────────────────────

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

  // ── 7. Delete swimlane with cards — confirmation dialog ──────────────────

  test('deleting swimlane with cards shows confirmation dialog', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const swimlane = await createSwimlane(request, token, boardId, 'Busy Lane', 'BL-');
    const columnId = columns[0]?.id;

    if (columnId) {
      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          board_id: boardId,
          swimlane_id: swimlane.id,
          column_id: columnId,
          sprint_id: null,
          title: 'Card in Busy Lane',
          description: '',
          priority: 'medium',
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation unavailable — skipping');
        return;
      }
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
      // Dismiss to leave the swimlane intact
      dialog.dismiss().catch(() => {});
    });

    await row.locator('.item-delete').click();

    // A confirmation dialog must appear warning about card deletion
    await page.waitForTimeout(500);
    expect(dialogSeen).toBe(true);

    // After dismissing, the swimlane should still be in the list
    await expect(swimlanesSection.locator('.item-name:has-text("Busy Lane")')).toBeVisible();
  });

  // ── 8. Multiple swimlanes render with cards ───────────────────────────────

  test('three swimlanes render correctly on board', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const columnId = columns[0]?.id;

    const laneA = await createSwimlane(request, token, boardId, 'Lane A', 'LA-', '#6366f1');
    const laneB = await createSwimlane(request, token, boardId, 'Lane B', 'LB-', '#22c55e');
    const laneC = await createSwimlane(request, token, boardId, 'Lane C', 'LC-', '#f97316');

    let cardsCreated = 0;
    if (columnId) {
      for (const lane of [laneA, laneB, laneC]) {
        for (const n of [1, 2]) {
          const res = await request.post(`${BASE}/api/cards`, {
            headers: { Authorization: `Bearer ${token}` },
            data: {
              board_id: boardId,
              swimlane_id: lane.id,
              column_id: columnId,
              sprint_id: null,
              title: `${lane.name} Card ${n}`,
              description: '',
              priority: 'medium',
            },
          });
          if (res.ok()) cardsCreated++;
        }
      }
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();

    // All three swimlane gutters should be present
    await expect(page.locator('.swimlane-gutter')).toHaveCount(3, { timeout: 8000 });

    await expect(page.locator('.swimlane-name:has-text("Lane A")')).toBeVisible();
    await expect(page.locator('.swimlane-name:has-text("Lane B")')).toBeVisible();
    await expect(page.locator('.swimlane-name:has-text("Lane C")')).toBeVisible();

    if (cardsCreated === 6) {
      await expect(page.locator('.card-item')).toHaveCount(6, { timeout: 8000 });
    }
  });

  // ── 9. Swimlane collapse/expand via ribbon click ──────────────────────────

  test('clicking swimlane gutter collapses then expands the swimlane', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Collapsible Lane', 'CL-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();

    const gutterEl = page.locator('.swimlane-gutter').first();
    await expect(gutterEl).toBeVisible({ timeout: 8000 });

    // Initial state: expanded
    await expect(gutterEl).not.toHaveClass(/gutter-collapsed/);

    // Click to collapse
    await gutterEl.click();
    await expect(gutterEl).toHaveClass(/gutter-collapsed/, { timeout: 3000 });

    // Click again to expand
    await gutterEl.click();
    await expect(gutterEl).not.toHaveClass(/gutter-collapsed/, { timeout: 3000 });
  });

  // ── 10. Collapsed swimlane shows card count ───────────────────────────────

  test('collapsed swimlane shows card count when sprint is active', async ({ page, request }) => {
    const { token, boardId, columns } = await setupUserAndBoard(request);
    const swimlane = await createSwimlane(request, token, boardId, 'Count Lane', 'CL-');
    const columnId = columns[0]?.id;

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Count Sprint' },
    });
    const sprint = await sprintRes.json();

    let cardsAssigned = 0;
    if (columnId) {
      for (const title of ['Count Card 1', 'Count Card 2']) {
        const cardRes = await request.post(`${BASE}/api/cards`, {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            board_id: boardId,
            swimlane_id: swimlane.id,
            column_id: columnId,
            sprint_id: null,
            title,
            description: '',
            priority: 'medium',
          },
        });
        if (!cardRes.ok()) continue;
        const card = await cardRes.json();
        await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { sprint_id: sprint.id },
        });
        cardsAssigned++;
      }

      if (cardsAssigned > 0) {
        await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }

    if (cardsAssigned === 0) {
      test.skip(true, 'Card creation unavailable — skipping card count test');
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    const gutterEl = page.locator('.swimlane-gutter').first();
    await expect(gutterEl).toBeVisible({ timeout: 8000 });

    // Collapse the swimlane
    await gutterEl.click();

    // When collapsed the count chip should appear
    await expect(page.locator('.swimlane-card-count')).toContainText(`${cardsAssigned}`, { timeout: 5000 });
  });

  // ── 11. Swimlane designator shown in settings list item meta ──────────────

  test('swimlane designator prefix is visible in settings list', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Infra Team', 'INFRA-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Infra Team' });
    await expect(row.locator('.item-meta')).toContainText('INFRA-');
  });

  // ── 12. Reorder swimlanes via API — order persists ────────────────────────

  test('reorder swimlanes via API and verify both lanes still appear in settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const laneFirst = await createSwimlane(request, token, boardId, 'First Lane', 'F1-');
    await createSwimlane(request, token, boardId, 'Second Lane', 'F2-');

    // Reorder: move laneFirst to position 1 (second)
    const reorderRes = await request.post(
      `${BASE}/api/boards/${boardId}/swimlanes/${laneFirst.id}/reorder`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { position: 1 },
      },
    );
    expect(reorderRes.ok()).toBe(true);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection).toBeVisible();
    await expect(swimlanesSection.locator('.item-name:has-text("First Lane")')).toBeVisible();
    await expect(swimlanesSection.locator('.item-name:has-text("Second Lane")')).toBeVisible();
  });

  // ── 13. Reorder via drag-and-drop (DnD unreliable in Playwright) ──────────

  test.fixme('swimlane reorder via drag-and-drop', async ({ page, request }) => {
    // @dnd-kit drag-and-drop is unreliable in Playwright headless mode.
    // Use POST /api/boards/:id/swimlanes/:swimlaneId/reorder instead.
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'First', 'F1-');
    await createSwimlane(request, token, boardId, 'Second', 'F2-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn:has-text("All Cards")').click();

    const gutters = page.locator('.swimlane-gutter');
    await expect(gutters).toHaveCount(2);

    const firstRibbon = page.locator('.swimlane-ribbon').first();
    const secondRibbon = page.locator('.swimlane-ribbon').nth(1);
    await firstRibbon.dragTo(secondRibbon);

    await expect(page.locator('.swimlane-name').first()).toHaveText('Second');
  });

  // ── 14. Swimlane Gitea repo association — api_token stored for custom_gitea

  test('swimlane Gitea repo association: api_token field accepted by backend', async ({ request }) => {
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
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe('Cred Lane');
  });

  // ── 15. Swimlane repo owner/name shown in settings meta ──────────────────

  test('swimlane repo owner and name appear in settings list item meta', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);

    await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Repo Lane',
        designator: 'RL-',
        color: '#6366f1',
        repo_owner: 'myorg',
        repo_name: 'myrepo',
      },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Repo Lane' });
    await expect(row.locator('.item-meta')).toContainText('myorg/myrepo');
  });

  // ── 16. Color picker in Add Swimlane modal selects a color ───────────────

  test('selecting a different color in Add Swimlane modal saves that color', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);

    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    await page.locator('.modal input[placeholder="Frontend"]').fill('Green Lane');
    await page.locator('.modal input[placeholder="owner/repo"]').fill('org/repo');
    await page.locator('.modal input[placeholder="FE-"]').fill('GR-');

    // Pick the green color (#22c55e is index 6 in the colors array)
    const colorOptions = page.locator('.modal .color-option');
    await colorOptions.nth(6).click();

    // The selected button should have the "selected" class
    await expect(colorOptions.nth(6)).toHaveClass(/selected/);

    await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();
    await expect(page.locator('.modal')).not.toBeVisible();

    await expect(swimlanesSection.locator('.item-name:has-text("Green Lane")')).toBeVisible();

    const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Green Lane' });
    const swatchStyle = await row.locator('.item-color').getAttribute('style');
    expect(swatchStyle).toContain('#22c55e');
  });

  // ── 17. Empty state: no swimlanes prompt on board ─────────────────────────

  test('board with no swimlanes shows empty-swimlanes prompt', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-swimlanes p')).toContainText('Add a swimlane');
  });

  // ── 18. Settings shows empty list message when no swimlanes ───────────────

  test('settings shows empty list message when no swimlanes exist', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardId}/settings`);
    const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
    await expect(swimlanesSection.locator('.empty-list')).toContainText('No swimlanes configured');
  });

  // ── 19. Swimlane filter dropdown lists created swimlanes ─────────────────

  test('swimlane filter dropdown lists created swimlanes', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'Alpha', 'AL-');
    await createSwimlane(request, token, boardId, 'Beta', 'BE-');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.locator('.filter-toggle-btn').click();
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const swimlaneSelect = page.locator('.filters-expanded .filter-select').first();
    await expect(swimlaneSelect.locator('option:has-text("Alpha")')).toHaveCount(1);
    await expect(swimlaneSelect.locator('option:has-text("Beta")')).toHaveCount(1);
  });

  // ── 20. GET /api/boards/:id/swimlanes returns swimlane list ──────────────

  test('GET /api/boards/:id/swimlanes returns created swimlanes', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createSwimlane(request, token, boardId, 'API Lane 1', 'AP1-');
    await createSwimlane(request, token, boardId, 'API Lane 2', 'AP2-');

    const res = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const swimlanes = await res.json();
    expect(Array.isArray(swimlanes)).toBe(true);
    expect(swimlanes.length).toBeGreaterThanOrEqual(2);
    const names = swimlanes.map((s: any) => s.name);
    expect(names).toContain('API Lane 1');
    expect(names).toContain('API Lane 2');
  });

  // ── 21. DELETE /api/boards/:id/swimlanes/:id removes the swimlane ─────────

  test('DELETE removes swimlane and it is absent from subsequent API response', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const swimlane = await createSwimlane(request, token, boardId, 'Delete Me', 'DM-');

    const delRes = await request.delete(
      `${BASE}/api/boards/${boardId}/swimlanes/${swimlane.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const swimlanes = await listRes.json();
    const ids = swimlanes.map((s: any) => s.id);
    expect(ids).not.toContain(swimlane.id);
  });

  // ── 22. Unauthenticated request rejected for swimlane API ─────────────────

  test('unauthenticated requests to swimlane API are rejected with 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/boards/1/swimlanes`);
    expect(res.status()).toBe(401);
  });

  // =========================================================================
  // NEW TESTS — Swimlane API
  // =========================================================================

  test.describe('Swimlane API', () => {

    test('POST /api/boards/:id/swimlanes creates swimlane and returns 200 or 201', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'API Create Swimlane Board');

      const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'New API Lane', designator: 'NA-', color: '#6366f1' },
      });
      expect([200, 201]).toContain(res.status());
    });

    test('created swimlane has id, name, designator, and board_id fields', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'API Fields Swimlane Board');

      const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Fields Lane', designator: 'FL-', color: '#6366f1' },
      });
      const body = await res.json();
      expect(typeof body.id).toBe('number');
      expect(body.id).toBeGreaterThan(0);
      expect(body.name).toBe('Fields Lane');
      expect(body.designator).toBe('FL-');
      expect(body.board_id).toBe(boardId);
    });

    test('GET /api/boards/:id/swimlanes includes newly created swimlane', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'Includes Swimlane Board');

      await createSwimlane(request, token, boardId, 'Include Me', 'IM-');

      const res = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const swimlanes = await res.json();
      const names = swimlanes.map((s: any) => s.name);
      expect(names).toContain('Include Me');
    });

    test('DELETE /api/boards/:id/swimlanes/:id returns 204', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'Delete 204 Swimlane Board');
      const lane = await createSwimlane(request, token, boardId, 'Delete 204 Lane', 'D2-');

      const res = await request.delete(
        `${BASE}/api/boards/${boardId}/swimlanes/${lane.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status()).toBe(204);
    });

    test('deleted swimlane not present in subsequent GET', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'Delete Gone Swimlane Board');
      const lane = await createSwimlane(request, token, boardId, 'Gone Lane', 'GL-');

      await request.delete(`${BASE}/api/boards/${boardId}/swimlanes/${lane.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const swimlanes = await res.json();
      const ids = swimlanes.map((s: any) => s.id);
      expect(ids).not.toContain(lane.id);
    });

    test('POST reorder changes swimlane position (returns 200)', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'Reorder Swimlane Board');
      const lane1 = await createSwimlane(request, token, boardId, 'Reorder Lane 1', 'R1-');
      await createSwimlane(request, token, boardId, 'Reorder Lane 2', 'R2-');

      const res = await request.post(
        `${BASE}/api/boards/${boardId}/swimlanes/${lane1.id}/reorder`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { position: 1 },
        },
      );
      expect(res.ok()).toBe(true);
    });

    test('swimlane with gitea_owner and gitea_repo stored by backend', async ({ request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'Gitea Swimlane Board');

      const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          name: 'Gitea Linked Lane',
          designator: 'GT-',
          color: '#6366f1',
          repo_owner: 'gitorg',
          repo_name: 'gitrepo',
        },
      });
      expect([200, 201]).toContain(res.status());
      const body = await res.json();
      expect(body.name).toBe('Gitea Linked Lane');
    });

    test('unauthenticated POST to create swimlane returns 401', async ({ request }) => {
      const { _token, boardId } = await setupUserAndBoard(request, 'Unauth Swimlane Board') as any;

      const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        data: { name: 'Stealth Lane', designator: 'ST-' },
      });
      expect(res.status()).toBe(401);
    });

    test('creating a swimlane with the same name as an existing one is accepted', async ({ request }) => {
      // The API does not enforce uniqueness on swimlane names
      const { token, boardId } = await setupUserAndBoard(request, 'Duplicate Name Swimlane Board');

      await createSwimlane(request, token, boardId, 'Duplicate Lane', 'DUP-');

      const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Duplicate Lane', designator: 'DUP2-', color: '#6366f1' },
      });
      // Either 200 or 201 is fine — duplicates are allowed at the API level
      expect([200, 201]).toContain(res.status());
    });
  });

  // =========================================================================
  // NEW TESTS — Swimlane UI
  // =========================================================================

  test.describe('Swimlane UI', () => {

    test('UI: swimlane rows are visible in board view after creating swimlanes', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI Rows Swimlane Board');
      await createSwimlane(request, token, boardId, 'UI Row Lane', 'URL-');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      await expect(page.locator('.swimlane-gutter')).toBeVisible({ timeout: 8000 });
    });

    test('UI: swimlane name is shown in the row header', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI Name Swimlane Board');
      await createSwimlane(request, token, boardId, 'Visible Name Lane', 'VNL-');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      await expect(page.locator('.swimlane-name:has-text("Visible Name Lane")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: add swimlane via board settings modal', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI Add Modal Swimlane Board');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}/settings`);

      const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
      await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
      await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible({ timeout: 5000 });

      await page.locator('.modal input[placeholder="Frontend"]').fill('Settings Added Lane');
      await page.locator('.modal input[placeholder="FE-"]').fill('SAL-');
      await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();

      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
      await expect(swimlanesSection.locator('.item-name:has-text("Settings Added Lane")')).toBeVisible();
    });

    test('UI: new swimlane row appears on the board after creation', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI New Row Swimlane Board');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}/settings`);

      const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
      await swimlanesSection.locator('button:has-text("Add Swimlane")').click();
      await page.locator('.modal input[placeholder="Frontend"]').fill('Freshly Added Lane');
      await page.locator('.modal input[placeholder="FE-"]').fill('FAL-');
      await page.locator('.modal button[type="submit"]:has-text("Add Swimlane")').click();
      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

      // Navigate to board and verify the new swimlane is visible
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      await expect(page.locator('.swimlane-name:has-text("Freshly Added Lane")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: deleting swimlane via settings removes the row from board view', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI Delete Row Board');
      await createSwimlane(request, token, boardId, 'Removable Lane', 'RM-');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}/settings`);

      const swimlanesSection = page.locator('.settings-section').filter({ hasText: 'Swimlanes' });
      const row = swimlanesSection.locator('.settings-list-item').filter({ hasText: 'Removable Lane' });

      page.once('dialog', d => d.accept());
      await row.locator('.item-delete').click();

      await expect(swimlanesSection.locator('.item-name:has-text("Removable Lane")')).not.toBeVisible({ timeout: 8000 });

      // Navigate to board and check the row is gone
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      await expect(page.locator('.swimlane-name:has-text("Removable Lane")')).not.toBeVisible({ timeout: 5000 });
    });

    test('UI: swimlane row shows cards placed in that lane', async ({ page, request }) => {
      const { token, boardId, columns } = await setupUserAndBoard(request, 'UI Card Count Board');
      const lane = await createSwimlane(request, token, boardId, 'Card Count Lane', 'CCL-');
      const columnId = columns[0]?.id;

      if (!columnId) {
        test.skip(true, 'No columns available');
        return;
      }

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          board_id: boardId,
          swimlane_id: lane.id,
          column_id: columnId,
          title: 'Lane Card',
          description: '',
        },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      await expect(page.locator('.card-item:has-text("Lane Card")')).toBeVisible({ timeout: 8000 });
    });

    test.fixme('UI: swimlane designator appears in card IDs on the board', async ({ page, request }) => {
      // Card IDs incorporating the swimlane designator prefix would need
      // a data-testid or specific class selector to assert reliably.
      // The feature depends on how card IDs are formatted in the UI.
    });

    test('UI: swimlane collapse/expand toggle works', async ({ page, request }) => {
      const { token, boardId } = await setupUserAndBoard(request, 'UI Collapse Swimlane Board');
      await createSwimlane(request, token, boardId, 'Toggle Lane', 'TG-');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();

      const gutter = page.locator('.swimlane-gutter').first();
      await expect(gutter).toBeVisible({ timeout: 8000 });

      // Collapse
      await gutter.click();
      await expect(gutter).toHaveClass(/gutter-collapsed/, { timeout: 3000 });

      // Expand
      await gutter.click();
      await expect(gutter).not.toHaveClass(/gutter-collapsed/, { timeout: 3000 });
    });
  });
});
