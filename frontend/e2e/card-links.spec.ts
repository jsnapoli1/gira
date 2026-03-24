import { test, expect, APIRequestContext } from '@playwright/test';

const PORT = process.env.PORT || 9002;

interface SetupResult {
  token: string;
  boardId: number;
  cardAId: number;
  cardBId: number;
}

async function setup(request: APIRequestContext): Promise<SetupResult> {
  const { token } = await (await request.post(`http://localhost:${PORT}/api/auth/signup`, {
    data: {
      email: `test-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      display_name: 'Tester',
    },
  })).json();

  // Create board (response is board object directly)
  const board = await (await request.post(`http://localhost:${PORT}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Link Test Board' },
  })).json();

  // Create a swimlane
  const swimlane = await (await request.post(`http://localhost:${PORT}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', repo_owner: 'test', repo_name: 'repo', designator: 'LK-', color: '#6366f1' },
  })).json();

  // Get columns (array directly)
  const columns: Array<{ id: number }> = await (await request.get(`http://localhost:${PORT}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  const columnId = columns[0].id;

  // Create Card A
  const cardA = await (await request.post(`http://localhost:${PORT}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Card Alpha', column_id: columnId, swimlane_id: swimlane.id, board_id: board.id },
  })).json();

  // Create Card B
  const cardB = await (await request.post(`http://localhost:${PORT}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Card Beta', column_id: columnId, swimlane_id: swimlane.id, board_id: board.id },
  })).json();

  return { token, boardId: board.id, cardAId: cardA.id, cardBId: cardB.id };
}

async function loginWithToken(page: import('@playwright/test').Page, token: string) {
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
}

async function openCardModal(page: import('@playwright/test').Page, cardTitle: string) {
  const cardItem = page.locator(`.card-item:has(.card-title:has-text("${cardTitle}"))`);
  await expect(cardItem).toBeVisible({ timeout: 10000 });
  await cardItem.click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
}

test.describe('Card Links', () => {
  test('should add a link between cards', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await loginWithToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open Card Alpha's modal
    await openCardModal(page, 'Card Alpha');

    // Find the links sidebar and click '+' to open the add-link form
    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible();
    await linksSidebar.locator('.btn-xs:has-text("+")').click();

    // The add-link form should appear
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    // Select link type 'relates_to'
    await linksSidebar.locator('.link-type-select').selectOption('relates_to');

    // Type enough chars to trigger search (need >= 2 chars)
    await linksSidebar.locator('.link-search-input').fill('Card B');

    // Wait for search results
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });

    // Click on Card Beta in the results
    await linksSidebar.locator('.link-search-result-item:has(.link-result-title:has-text("Card Beta"))').click();

    // The link should now appear in the links list
    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });
    await expect(linksSidebar.locator('.link-group-label:has-text("Related")')).toBeVisible();
  });

  test('should remove a card link', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    // Create the link via API
    await request.post(`http://localhost:${PORT}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    await loginWithToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    const linkItem = linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))');
    await expect(linkItem).toBeVisible({ timeout: 5000 });

    // Click the delete button on the link — no window.confirm for link deletion
    await linkItem.locator('.link-delete-btn').click();

    // The link item should disappear
    await expect(linkItem).not.toBeVisible();
    // The empty state should now show
    await expect(linksSidebar.locator('.empty-text:has-text("No links")')).toBeVisible();
  });

  test('should show empty state when card has no links', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await loginWithToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible();

    // Should display "No links" empty state (add-link form is collapsed)
    await expect(linksSidebar.locator('.empty-text:has-text("No links")')).toBeVisible({ timeout: 5000 });
    // Link count label should show 0
    await expect(linksSidebar.locator('label')).toContainText('Links (0)');
  });

  test('link type bidirectional — Card B shows "Blocked By" when Card A blocks it', async ({ page, request }) => {
    // NOTE: The backend stores links with their original link_type and does NOT automatically
    // flip the type for the target card's perspective. Both Card A and Card B see "Blocks".
    // This test documents the current limitation with test.fixme().
    test.fixme(true, 'Backend does not flip link_type for target card perspective — Card B shows "Blocks" not "Blocked By"');

    const { token, boardId, cardAId, cardBId } = await setup(request);

    // Card A blocks Card B
    await request.post(`http://localhost:${PORT}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'blocks' },
    });

    await loginWithToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Card A should show "Blocks" group
    await openCardModal(page, 'Card Alpha');
    const linksSidebarA = page.locator('.links-sidebar');
    await expect(linksSidebarA.locator('.link-group-label:has-text("Blocks")')).toBeVisible({ timeout: 5000 });
    await page.click('.modal-close-btn');

    // Card B should show "Blocked By" group (bidirectional — this is the fixme case)
    await openCardModal(page, 'Card Beta');
    const linksSidebarB = page.locator('.links-sidebar');
    await expect(linksSidebarB.locator('.link-group-label:has-text("Blocked By")')).toBeVisible({ timeout: 5000 });
  });
});
