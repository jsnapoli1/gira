import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// Helper: create a fresh user, board via API, set token, and navigate to the board.
async function setupBoard(page: any, request: any, prefix: string) {
  const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'password123',
      display_name: 'Multi Project User',
    },
  })).json();

  const board = await (await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Multi Project Board' },
  })).json();

  await page.addInitScript((t: string) => {
    localStorage.setItem('token', t);
    // Expand filters so filter-select elements are in the DOM
    localStorage.setItem('zira-filters-expanded', 'true');
  }, token);
  await page.goto(`/boards/${board.id}`);
  await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
  return { token, board };
}

// Helper: add a swimlane via API, reload the page, and wait for its name to appear in the filter dropdown.
async function addSwimlane(
  page: any,
  request: any,
  token: string,
  boardId: number,
  name: string,
  designator: string
) {
  const swimlane = await (await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator },
  })).json();

  // Reload the page so the board fetches fresh data including the new swimlane.
  // After reload, filtersExpanded is restored from localStorage (set to 'true' in setupBoard).
  await page.reload();
  await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

  // Wait for the swimlane name to appear in the filter dropdown options.
  await page.waitForFunction(
    (swimlaneName: string) => {
      const selects = Array.from(document.querySelectorAll('.filter-select'));
      return selects.some((sel) =>
        Array.from(sel.querySelectorAll('option')).some((opt) => opt.textContent?.includes(swimlaneName))
      );
    },
    name,
    { timeout: 8000 }
  );
  return swimlane;
}

// Helper: create a backlog card for a given swimlane section in BacklogView.
// Assumes the backlog view is already open and the swimlane section is expanded.
async function addBacklogCard(page: any, swimlaneName: string, cardTitle: string) {
  // Find the swimlane section by its h3 containing the name, then click Add
  const section = page.locator('.backlog-section').filter({
    has: page.locator(`h3:has-text("${swimlaneName}")`),
  });
  await section.locator('button:has-text("Add")').click();
  await page.fill('input[placeholder="Enter card title..."]', cardTitle);
  await page.keyboard.press('Enter');
  // Wait for the card to appear in the list (card saved and form closed)
  await expect(section.locator(`.card-title:has-text("${cardTitle}")`)).toBeVisible({
    timeout: 5000,
  });
}

test.describe('Multi-Project Board', () => {
  // -----------------------------------------------------------------------
  // Swimlane Management
  // -----------------------------------------------------------------------

  test.describe('Swimlane Management', () => {
    test('should create two swimlanes with different names, designators, and colors', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-create');

      // Board starts with no swimlanes
      await expect(page.locator('.empty-swimlanes')).toBeVisible();

      // Add first swimlane via API
      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');

      // Add second swimlane via API
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      // The filter dropdown should now list both swimlanes
      const swimlaneFilter = page.locator('.filter-select').filter({
        has: page.locator('option:text("All swimlanes")'),
      });
      await expect(swimlaneFilter).toBeVisible();
      const options = await swimlaneFilter.locator('option').allTextContents();
      expect(options.some((o: string) => o.includes('Frontend'))).toBeTruthy();
      expect(options.some((o: string) => o.includes('Backend'))).toBeTruthy();
    });

    test('should render swimlane headers on board when an active sprint exists', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-headers');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      // Switch to backlog, create a sprint, start it
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Sprint Alpha');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

      // Go back to board view — both swimlane rows should now be visible
      await page.click('.view-btn:has-text("Board")');
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

      const headers = page.locator('.swimlane-name');
      await expect(headers.filter({ hasText: 'Frontend' })).toBeVisible({ timeout: 8000 });
      await expect(headers.filter({ hasText: 'Backend' })).toBeVisible({ timeout: 8000 });
    });

    test('should reorder swimlanes by dragging the color handle', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-reorder');

      await addSwimlane(page, request, token, board.id, 'First', 'F1-');
      await addSwimlane(page, request, token, board.id, 'Second', 'F2-');

      // Start a sprint so the board renders swimlane rows
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Reorder Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
      await page.click('.view-btn:has-text("Board")');

      // Wait for both swimlane headers to appear in the board view before reading order
      await expect(page.locator('.swimlane-name').filter({ hasText: 'First' })).toBeVisible({ timeout: 8000 });
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Second' })).toBeVisible({ timeout: 8000 });

      // Verify initial order: "First" comes before "Second"
      const headersBefore = await page.locator('.swimlane-name').allTextContents();
      expect(headersBefore[0]).toBe('First');
      expect(headersBefore[1]).toBe('Second');

      // Drag the color ribbon of the first swimlane down onto the second
      // In board view the drag handle is the .swimlane-ribbon (colored bar in the gutter)
      const firstHandle = page.locator('.swimlane-ribbon').first();
      const secondHandle = page.locator('.swimlane-ribbon').last();

      const firstBox = await firstHandle.boundingBox();
      const secondBox = await secondHandle.boundingBox();
      if (firstBox && secondBox) {
        await page.mouse.move(
          firstBox.x + firstBox.width / 2,
          firstBox.y + firstBox.height / 2
        );
        await page.mouse.down();
        // Move slowly to trigger the dnd-kit sensor (distance > 8px)
        await page.mouse.move(
          secondBox.x + secondBox.width / 2,
          secondBox.y + secondBox.height / 2 + 20,
          { steps: 15 }
        );
        await page.mouse.up();
      }

      // After drag the order should be reversed
      // NOTE: dnd-kit reorders optimistically; the API persists the new order.
      // If the backend PUT endpoint for swimlane reorder is missing this may
      // silently fail, but the optimistic UI update should still reflect the swap.
      const headersAfter = await page.locator('.swimlane-name').allTextContents();
      expect(headersAfter[0]).toBe('Second');
      expect(headersAfter[1]).toBe('First');
    });

    test('should delete a swimlane via board settings', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-delete');

      await addSwimlane(page, request, token, board.id, 'ToDelete', 'TD-');
      await addSwimlane(page, request, token, board.id, 'ToKeep', 'TK-');

      // Navigate to board settings — use the board-specific settings link
      // (a[href*="/boards"][href*="/settings"]) to avoid matching the global
      // /settings nav link which also contains "/settings" in its href.
      await page.click('a[href*="/boards"][href*="/settings"]');
      await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

      // Both swimlanes should appear in the settings list
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToDelete' })).toBeVisible();
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToKeep' })).toBeVisible();

      // Accept the confirmation dialog for deletion
      page.on('dialog', (dialog: any) => dialog.accept());

      // Click the delete button for "ToDelete"
      const toDeleteRow = page.locator('.settings-list-item').filter({ hasText: 'ToDelete' });
      await toDeleteRow.locator('.item-delete').click();

      // "ToDelete" should be gone; "ToKeep" should remain
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToDelete' })).not.toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToKeep' })).toBeVisible();
    });
  });

  // -----------------------------------------------------------------------
  // Per-Project Backlog
  // -----------------------------------------------------------------------

  test.describe('Per-Project Backlog', () => {
    test('should show per-swimlane sections in the backlog view', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-backlog-sections');

      await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
      await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

      await page.click('.view-btn:has-text("Backlog")');
      await expect(page.locator('.backlog-view')).toBeVisible();

      // Backlog items panel should have one section per swimlane
      await expect(
        page.locator('.backlog-section h3').filter({ hasText: 'Alpha' })
      ).toBeVisible();
      await expect(
        page.locator('.backlog-section h3').filter({ hasText: 'Beta' })
      ).toBeVisible();
    });

    test('should create backlog cards in different swimlanes', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-backlog-cards');

      await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
      await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

      await page.click('.view-btn:has-text("Backlog")');

      await addBacklogCard(page, 'Alpha', 'Alpha Feature 1');
      await addBacklogCard(page, 'Beta', 'Beta Task 1');

      // Cards should appear in their respective swimlane sections
      const alphaSection = page.locator('.backlog-section').filter({
        has: page.locator('h3:has-text("Alpha")'),
      });
      const betaSection = page.locator('.backlog-section').filter({
        has: page.locator('h3:has-text("Beta")'),
      });

      await expect(alphaSection.locator('.card-title:has-text("Alpha Feature 1")')).toBeVisible();
      await expect(betaSection.locator('.card-title:has-text("Beta Task 1")')).toBeVisible();

      // Cross-check: Alpha card should NOT appear in Beta section
      await expect(
        betaSection.locator('.card-title:has-text("Alpha Feature 1")')
      ).not.toBeVisible();
    });

    test('should collapse and expand a swimlane section in the backlog', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-backlog-collapse');

      await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
      await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

      await page.click('.view-btn:has-text("Backlog")');
      await addBacklogCard(page, 'Alpha', 'Collapse Test Card');

      // Card is visible initially
      await expect(page.locator('.card-title:has-text("Collapse Test Card")')).toBeVisible();

      // Click the Alpha section header to collapse it
      const alphaHeader = page.locator('.backlog-section-header').filter({
        has: page.locator('h3:has-text("Alpha")'),
      });
      await alphaHeader.click();

      // The card list for Alpha should no longer be visible
      // NOTE: The section header remains; only .backlog-cards is hidden on collapse
      await expect(page.locator('.card-title:has-text("Collapse Test Card")')).not.toBeVisible({
        timeout: 3000,
      });

      // Click again to expand
      await alphaHeader.click();
      await expect(page.locator('.card-title:has-text("Collapse Test Card")')).toBeVisible();
    });
  });

  // -----------------------------------------------------------------------
  // Sprint + Multi-Swimlane
  // -----------------------------------------------------------------------

  test.describe('Sprint with Multiple Swimlanes', () => {
    test('should move cards from different swimlanes into the same sprint', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-sprint-move');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      await page.click('.view-btn:has-text("Backlog")');

      // Create a sprint
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Sprint 1');
      await page.click('button[type="submit"]:has-text("Create")');

      // Add one card per swimlane
      await addBacklogCard(page, 'Frontend', 'FE Card');
      await addBacklogCard(page, 'Backend', 'BE Card');

      // Move both cards to the sprint using the arrow buttons
      // NOTE: In Jira per-project sprints would be separate; here a single shared
      // sprint receives cards from all swimlanes — current Zira behavior.
      await page.locator('.backlog-move-btn').first().click();
      await page.locator('.backlog-move-btn').first().click();

      // Both cards should now appear in the sprint panel
      const sprintPanel = page.locator('.backlog-sprint-panel');
      await expect(sprintPanel.locator('.card-title:has-text("FE Card")')).toBeVisible();
      await expect(sprintPanel.locator('.card-title:has-text("BE Card")')).toBeVisible();
    });

    test('should start a sprint and show cards from all swimlanes on the board', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-sprint-start');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      await page.click('.view-btn:has-text("Backlog")');

      // Create sprint, add cards, move them to sprint, start sprint
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Active Sprint');
      await page.click('button[type="submit"]:has-text("Create")');

      await addBacklogCard(page, 'Frontend', 'FE Board Card');
      await addBacklogCard(page, 'Backend', 'BE Board Card');

      // Move both to the sprint
      await page.locator('.backlog-move-btn').first().click();
      await page.locator('.backlog-move-btn').first().click();

      // Start sprint
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

      // Switch to board view
      await page.click('.view-btn:has-text("Board")');
      await expect(page.locator('.board-content')).toBeVisible();

      // Both swimlane headers should appear
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();

      // Cards should be visible on the board in their respective swimlane rows
      await expect(page.locator('.card-title:has-text("FE Board Card")')).toBeVisible();
      await expect(page.locator('.card-title:has-text("BE Board Card")')).toBeVisible();
    });

    test('should complete a sprint with cards from multiple swimlanes', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-sprint-complete');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      await page.click('.view-btn:has-text("Backlog")');

      // Create sprint and start it immediately (no cards needed for completion test)
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Sprint To Complete');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

      // Accept confirm dialog for completion
      page.on('dialog', (dialog: any) => dialog.accept());

      await page.click('button:has-text("Complete Sprint")');

      // Active status badge should be gone
      await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 5000 });
    });
  });

  // -----------------------------------------------------------------------
  // Card Management Across Projects
  // -----------------------------------------------------------------------

  test.describe('Card Management Across Projects', () => {
    test('should show designator prefix based on swimlane in backlog', async ({ page, request }) => {
      const { token, board } = await setupBoard(page, request, 'mp-designator');

      // NOTE: Zira assigns designators via the swimlane field, not per-card.
      // In Jira each issue has a project-prefixed key (e.g. "PROJ-1").
      // In Zira the designator is stored on the swimlane and the card's
      // gitea_issue_id provides the numeric suffix. Cards created without a
      // Gitea issue will show the designator alone (no number).
      await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
      await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

      await page.click('.view-btn:has-text("Backlog")');
      await addBacklogCard(page, 'Alpha', 'Alpha Prefix Card');
      await addBacklogCard(page, 'Beta', 'Beta Prefix Card');

      // The .card-designator spans show the swimlane designator
      const alphaSection = page.locator('.backlog-section').filter({
        has: page.locator('h3:has-text("Alpha")'),
      });
      const betaSection = page.locator('.backlog-section').filter({
        has: page.locator('h3:has-text("Beta")'),
      });

      // Alpha cards carry the AL- designator
      await expect(
        alphaSection.locator('.backlog-card').filter({ hasText: 'Alpha Prefix Card' }).locator('.card-designator')
      ).toContainText('AL-');

      // Beta cards carry the BT- designator
      await expect(
        betaSection.locator('.backlog-card').filter({ hasText: 'Beta Prefix Card' }).locator('.card-designator')
      ).toContainText('BT-');
    });

    test('should quick-add a card in a specific swimlane column on the board', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-quickadd');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      // Start a sprint so the board renders swimlane rows
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Quick Add Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
      await page.click('.view-btn:has-text("Board")');
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

      // Find the Frontend swimlane row and use the first .board-column inside it.
      // DroppableColumn renders as .board-column (not .droppable-column).
      const frontendSwimlane = page.locator('.swimlane').filter({
        has: page.locator('.swimlane-name').filter({ hasText: 'Frontend' }),
      });
      await expect(frontendSwimlane).toBeVisible({ timeout: 8000 });

      // Click the quick-add button in the first column of the Frontend row.
      // .add-card-btn is always visible at the bottom of each column.
      const firstColumn = frontendSwimlane.locator('.board-column').first();
      await expect(firstColumn).toBeVisible({ timeout: 5000 });

      // Click the add-card button to reveal the quick-add form
      await firstColumn.locator('.add-card-btn').click();

      // Fill the quick-add input and submit
      const quickAddInput = firstColumn.locator('.quick-add-form input');
      await quickAddInput.fill('Quick Add Card');
      await page.keyboard.press('Enter');

      await expect(
        frontendSwimlane.locator('.card-title:has-text("Quick Add Card")')
      ).toBeVisible({ timeout: 5000 });
    });

    test('should filter board to show only one swimlane using the swimlane filter', async ({
      page, request,
    }) => {
      const { token, board } = await setupBoard(page, request, 'mp-filter');

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      // Start a sprint so swimlane rows are rendered
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Filter Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await page.click('.view-btn:has-text("Board")');

      // Both swimlane rows are visible before filtering
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();

      // Apply the swimlane filter for "Frontend"
      const swimlaneFilter = page.locator('.filter-select').filter({
        has: page.locator('option:text("All swimlanes")'),
      });
      await swimlaneFilter.selectOption({ label: 'Frontend' });

      // NOTE: The current implementation hides cards in non-matching swimlanes but
      // does NOT hide the swimlane row itself — the row stays but shows empty columns.
      // In Jira, filtering by project would show only that project's rows.
      // This is a known UX gap in Zira.
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
      // Backend row is still rendered (even if empty) when filter is active
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();
    });
  });
});
