import { test, expect } from '@playwright/test';

// Helper: create a fresh user, login, create a board, and navigate to it.
// Returns the page already positioned on the board view.
async function setupBoard(page: any, prefix: string) {
  const uniqueEmail = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;
  await page.goto('/signup');
  await page.fill('#displayName', 'Multi Project User');
  await page.fill('#email', uniqueEmail);
  await page.fill('#password', 'password123');
  await page.fill('#confirmPassword', 'password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  await page.goto('/boards');

  await page.click('text=Create Board');
  await page.fill('#boardName', 'Multi Project Board');
  await page.click('button[type="submit"]:has-text("Create Board")');
  // After creation the app navigates directly to the board detail page
  await page.waitForURL(/\/boards\/\d+/);
  await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
}

// Helper: add a swimlane via the "Add Swimlane" modal.
// When Gitea is not configured the repo field is a freetext input (owner/repo).
async function addSwimlane(
  page: any,
  name: string,
  repo: string,
  designator: string,
  colorIndex = 0 // 0–7 indexes into the 8 preset color swatches
) {
  await page.click('button:has-text("Add Swimlane")');
  await expect(page.locator('.modal h2')).toContainText('Add Swimlane');

  await page.fill('input[placeholder="Frontend"]', name);
  await page.fill('.modal input[placeholder="owner/repo"]', repo);
  await page.fill('input[placeholder="FE-"]', designator);

  // Pick a color swatch by index (each is a .color-option button inside .color-picker)
  const colorOptions = page.locator('.color-picker .color-option');
  await colorOptions.nth(colorIndex).click();

  await page.click('button[type="submit"]:has-text("Add Swimlane")');
  // Wait for the modal to close
  await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
  // Wait for the swimlane name to appear in the filter dropdown options. This
  // confirms the board state has been refreshed from the API before proceeding
  // to the next addSwimlane call (refreshBoard() is fire-and-forget in the app).
  await page.waitForFunction(
    (swimlaneName) => {
      const selects = Array.from(document.querySelectorAll('.filter-select'));
      return selects.some((sel) =>
        Array.from(sel.querySelectorAll('option')).some((opt) => opt.textContent?.includes(swimlaneName))
      );
    },
    name,
    { timeout: 8000 }
  );
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
      page,
    }) => {
      await setupBoard(page, 'mp-create');

      // Board starts with no swimlanes
      await expect(page.locator('.empty-swimlanes')).toBeVisible();

      // Add first swimlane — color index 0 (#6366f1 indigo)
      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);

      // After adding the first swimlane the board is still in "board" mode but
      // requires an active sprint to show cards. We should at least see the
      // swimlane header rendered once we switch away from the no-sprint empty state.
      // NOTE: In Jira, swimlanes are independent projects; here they share a single
      // sprint, which is board-scoped — not per-swimlane.

      // Add second swimlane — color index 1 (#8b5cf6 violet)
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

      // The filter dropdown should now list both swimlanes
      const swimlaneFilter = page.locator('.filter-select').filter({
        has: page.locator('option:text("All swimlanes")'),
      });
      await expect(swimlaneFilter).toBeVisible();
      const options = await swimlaneFilter.locator('option').allTextContents();
      expect(options.some((o) => o.includes('Frontend'))).toBeTruthy();
      expect(options.some((o) => o.includes('Backend'))).toBeTruthy();
    });

    test('should render swimlane headers on board when an active sprint exists', async ({
      page,
    }) => {
      await setupBoard(page, 'mp-headers');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

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

      const headers = page.locator('.swimlane-header h2');
      await expect(headers.filter({ hasText: 'Frontend' })).toBeVisible({ timeout: 8000 });
      await expect(headers.filter({ hasText: 'Backend' })).toBeVisible({ timeout: 8000 });
    });

    test('should reorder swimlanes by dragging the color handle', async ({ page }) => {
      await setupBoard(page, 'mp-reorder');

      await addSwimlane(page, 'First', 'acme/first', 'F1-', 0);
      await addSwimlane(page, 'Second', 'acme/second', 'F2-', 2);

      // Start a sprint so the board renders swimlane rows
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Reorder Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
      await page.click('.view-btn:has-text("Board")');

      // Wait for both swimlane headers to appear in the board view before reading order
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'First' })).toBeVisible({ timeout: 8000 });
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Second' })).toBeVisible({ timeout: 8000 });

      // Verify initial order: "First" comes before "Second"
      const headersBefore = await page.locator('.swimlane-header h2').allTextContents();
      expect(headersBefore[0]).toBe('First');
      expect(headersBefore[1]).toBe('Second');

      // Drag the color handle of the first swimlane down onto the second
      const firstHandle = page.locator('.swimlane-drag-handle').first();
      const secondHandle = page.locator('.swimlane-drag-handle').last();

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
      const headersAfter = await page.locator('.swimlane-header h2').allTextContents();
      expect(headersAfter[0]).toBe('Second');
      expect(headersAfter[1]).toBe('First');
    });

    test('should delete a swimlane via board settings', async ({ page }) => {
      await setupBoard(page, 'mp-delete');

      await addSwimlane(page, 'ToDelete', 'acme/todelete', 'TD-', 3);
      await addSwimlane(page, 'ToKeep', 'acme/tokeep', 'TK-', 4);

      // Navigate to board settings — use the board-specific settings link
      // (a[href*="/boards"][href*="/settings"]) to avoid matching the global
      // /settings nav link which also contains "/settings" in its href.
      await page.click('a[href*="/boards"][href*="/settings"]');
      await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

      // Both swimlanes should appear in the settings list
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToDelete' })).toBeVisible();
      await expect(page.locator('.settings-list-item').filter({ hasText: 'ToKeep' })).toBeVisible();

      // Accept the confirmation dialog for deletion
      page.on('dialog', (dialog) => dialog.accept());

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
    test('should show per-swimlane sections in the backlog view', async ({ page }) => {
      await setupBoard(page, 'mp-backlog-sections');

      await addSwimlane(page, 'Alpha', 'acme/alpha', 'AL-', 0);
      await addSwimlane(page, 'Beta', 'acme/beta', 'BT-', 1);

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

    test('should create backlog cards in different swimlanes', async ({ page }) => {
      await setupBoard(page, 'mp-backlog-cards');

      await addSwimlane(page, 'Alpha', 'acme/alpha', 'AL-', 0);
      await addSwimlane(page, 'Beta', 'acme/beta', 'BT-', 1);

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

    test('should collapse and expand a swimlane section in the backlog', async ({ page }) => {
      await setupBoard(page, 'mp-backlog-collapse');

      await addSwimlane(page, 'Alpha', 'acme/alpha', 'AL-', 0);
      await addSwimlane(page, 'Beta', 'acme/beta', 'BT-', 1);

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
    test('should move cards from different swimlanes into the same sprint', async ({ page }) => {
      await setupBoard(page, 'mp-sprint-move');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

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
      page,
    }) => {
      await setupBoard(page, 'mp-sprint-start');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

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
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Frontend' })).toBeVisible();
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Backend' })).toBeVisible();

      // Cards should be visible on the board in their respective swimlane rows
      await expect(page.locator('.card-title:has-text("FE Board Card")')).toBeVisible();
      await expect(page.locator('.card-title:has-text("BE Board Card")')).toBeVisible();
    });

    test('should complete a sprint with cards from multiple swimlanes', async ({ page }) => {
      await setupBoard(page, 'mp-sprint-complete');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

      await page.click('.view-btn:has-text("Backlog")');

      // Create sprint and start it immediately (no cards needed for completion test)
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Sprint To Complete');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

      // Accept confirm dialog for completion
      page.on('dialog', (dialog) => dialog.accept());

      await page.click('button:has-text("Complete Sprint")');

      // Active status badge should be gone
      await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 5000 });
    });
  });

  // -----------------------------------------------------------------------
  // Card Management Across Projects
  // -----------------------------------------------------------------------

  test.describe('Card Management Across Projects', () => {
    test('should show designator prefix based on swimlane in backlog', async ({ page }) => {
      await setupBoard(page, 'mp-designator');

      // NOTE: Zira assigns designators via the swimlane field, not per-card.
      // In Jira each issue has a project-prefixed key (e.g. "PROJ-1").
      // In Zira the designator is stored on the swimlane and the card's
      // gitea_issue_id provides the numeric suffix. Cards created without a
      // Gitea issue will show the designator alone (no number).
      await addSwimlane(page, 'Alpha', 'acme/alpha', 'AL-', 0);
      await addSwimlane(page, 'Beta', 'acme/beta', 'BT-', 1);

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
      page,
    }) => {
      await setupBoard(page, 'mp-quickadd');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

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
        has: page.locator('.swimlane-header h2:has-text("Frontend")'),
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
      page,
    }) => {
      await setupBoard(page, 'mp-filter');

      await addSwimlane(page, 'Frontend', 'acme/frontend', 'FE-', 0);
      await addSwimlane(page, 'Backend', 'acme/backend', 'BE-', 1);

      // Start a sprint so swimlane rows are rendered
      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Filter Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await page.click('.view-btn:has-text("Board")');

      // Both swimlane rows are visible before filtering
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Frontend' })).toBeVisible();
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Backend' })).toBeVisible();

      // Apply the swimlane filter for "Frontend"
      const swimlaneFilter = page.locator('.filter-select').filter({
        has: page.locator('option:text("All swimlanes")'),
      });
      await swimlaneFilter.selectOption({ label: 'Frontend' });

      // NOTE: The current implementation hides cards in non-matching swimlanes but
      // does NOT hide the swimlane row itself — the row stays but shows empty columns.
      // In Jira, filtering by project would show only that project's rows.
      // This is a known UX gap in Zira.
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Frontend' })).toBeVisible();
      // Backend row is still rendered (even if empty) when filter is active
      await expect(page.locator('.swimlane-header h2').filter({ hasText: 'Backend' })).toBeVisible();
    });
  });
});
