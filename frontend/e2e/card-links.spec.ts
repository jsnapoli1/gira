import { test, expect, APIRequestContext } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function createUser(request: APIRequestContext) {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Test User' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardAId: number;
  cardBId: number;
}

async function setup(request: APIRequestContext): Promise<SetupResult> {
  const { token } = await createUser(request);

  const board = await (await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Link Test Board' },
  })).json();

  // Board creation returns the board with columns embedded
  const columnId: number = board.columns[0].id;

  const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'LK-' },
  })).json();

  const cardA = await (await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Card Alpha', column_id: columnId, swimlane_id: swimlane.id, board_id: board.id },
  })).json();

  const cardB = await (await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Card Beta', column_id: columnId, swimlane_id: swimlane.id, board_id: board.id },
  })).json();

  return {
    token,
    boardId: board.id,
    columnId,
    swimlaneId: swimlane.id,
    cardAId: cardA.id,
    cardBId: cardB.id,
  };
}

async function navigateToBoard(
  page: import('@playwright/test').Page,
  token: string,
  boardId: number,
) {
  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

async function openCardModal(page: import('@playwright/test').Page, cardTitle: string) {
  const cardItem = page.locator(`.card-item:has(.card-title:has-text("${cardTitle}"))`);
  await expect(cardItem).toBeVisible({ timeout: 10000 });
  await cardItem.click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
}

async function closeModal(page: import('@playwright/test').Page) {
  await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
}

// ─── API-level tests (fast, no UI required) ──────────────────────────────────

test.describe('Card Links — API', () => {
  test('POST /api/cards/:id/links creates a relates_to link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(link.id).toBeGreaterThan(0);
    expect(link.source_card_id).toBe(cardAId);
    expect(link.target_card_id).toBe(cardBId);
    expect(link.link_type).toBe('relates_to');
  });

  test('POST /api/cards/:id/links creates a blocks link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'blocks' },
    });

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(link.link_type).toBe('blocks');
  });

  test('POST /api/cards/:id/links creates a duplicates link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'duplicates' },
    });

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(link.link_type).toBe('duplicates');
  });

  test('POST /api/cards/:id/links creates an is_blocked_by link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'is_blocked_by' },
    });

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(link.link_type).toBe('is_blocked_by');
  });

  test('POST /api/cards/:id/links rejects invalid link_type', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'invalid_type' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST /api/cards/:id/links rejects self-link', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardAId, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(400);
  });

  test('GET /api/cards/:id/links returns links for source card', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const links = await res.json();
    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBe(1);
    expect(links[0].link_type).toBe('relates_to');
  });

  test('GET /api/cards/:id/links returns empty array when no links', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const links = await res.json();
    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBe(0);
  });

  test('GET /api/cards/:id/links returns link from target card perspective', async ({ request }) => {
    // The DB returns links where card is source OR target, so card B can see
    // the link created from card A.
    const { token, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'blocks' },
    });

    const res = await request.get(`${BASE}/api/cards/${cardBId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const links = await res.json();
    expect(links.length).toBe(1);
    expect(links[0].link_type).toBe('blocks');
  });

  test('GET /api/cards/:id/links populates source_card and target_card', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const links = await res.json();
    expect(links[0].source_card).toBeTruthy();
    expect(links[0].target_card).toBeTruthy();
    expect(links[0].source_card.title).toBe('Card Alpha');
    expect(links[0].target_card.title).toBe('Card Beta');
  });

  test('DELETE /api/cards/:id/links/:linkId removes the link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const createRes = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });
    const link = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(deleteRes.status()).toBe(204);

    // Verify it's gone
    const getRes = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const links = await getRes.json();
    expect(links.length).toBe(0);
  });

  test('DELETE /api/cards/:id/links/:linkId returns 404 for unknown link', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    const res = await request.delete(`${BASE}/api/cards/${cardAId}/links/999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(404);
  });

  test('unauthenticated request to GET links returns 401', async ({ request }) => {
    const { cardAId } = await setup(request);

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to POST link returns 401', async ({ request }) => {
    const { cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });
    expect(res.status()).toBe(401);
  });

  test('cross-board link is rejected', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    // Create a separate board and card in it
    const boardB = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Other Board' },
    })).json();

    const swimlaneB = await (await request.post(`${BASE}/api/boards/${boardB.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'OB-' },
    })).json();

    const cardC = await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card on Other Board',
        column_id: boardB.columns[0].id,
        swimlane_id: swimlaneB.id,
        board_id: boardB.id,
      },
    })).json();

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardC.id, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST /api/cards/:id/links rejects link to non-existent target card', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: 999999, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST /api/cards/:id/links on non-existent source card returns 404', async ({ request }) => {
    const { token, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/999999/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(404);
  });

  test('duplicate link is rejected', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    // Create the link once
    const first = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });
    expect(first.status()).toBe(201);

    // Attempt to create the same link again — should be rejected
    const second = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    expect(second.status()).toBeGreaterThanOrEqual(400);
  });

  test('multiple links on a single card', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId } = await setup(request);

    // Create two additional cards
    const cardC = await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Card Gamma', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    })).json();

    const cardD = await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Card Delta', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    })).json();

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardC.id, link_type: 'blocks' },
    });
    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardD.id, link_type: 'duplicates' },
    });

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const links = await res.json();
    expect(links.length).toBe(2);
  });
});

// ─── UI tests ────────────────────────────────────────────────────────────────

test.describe('Card Links — UI', () => {
  test('links sidebar shows "No links" empty state on a fresh card', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });
    await expect(linksSidebar.locator('label')).toContainText('Links (0)');
    await expect(linksSidebar.locator('.empty-text:has-text("No links")')).toBeVisible();
  });

  test('can add a "relates to" link between two cards via UI', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });

    // Open the add-link form
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    // Select link type
    await linksSidebar.locator('.link-type-select').selectOption('relates_to');

    // Search for Card Beta
    await linksSidebar.locator('.link-search-input').fill('Card B');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
    await linksSidebar.locator('.link-search-result-item:has(.link-result-title:has-text("Card Beta"))').click();

    // Verify the link appears in the list
    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });
    await expect(linksSidebar.locator('label')).toContainText('Links (1)');
  });

  test('can add a "blocks" link between two cards via UI', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    await linksSidebar.locator('.link-type-select').selectOption('blocks');
    await linksSidebar.locator('.link-search-input').fill('Card B');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
    await linksSidebar.locator('.link-search-result-item:has(.link-result-title:has-text("Card Beta"))').click();

    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });
    await expect(linksSidebar.locator('.link-group-label:has-text("Blocks")')).toBeVisible();
  });

  test('can add a "duplicates" link between two cards via UI', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    await linksSidebar.locator('.link-type-select').selectOption('duplicates');
    await linksSidebar.locator('.link-search-input').fill('Card B');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
    await linksSidebar.locator('.link-search-result-item:has(.link-result-title:has-text("Card Beta"))').click();

    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });
  });

  test('links persist after modal is closed and reopened', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    // Create link via API
    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });

    await closeModal(page);

    // Reopen and verify
    await openCardModal(page, 'Card Alpha');
    await expect(page.locator('.links-sidebar .link-item:has(.link-card-title:has-text("Card Beta"))')).toBeVisible({ timeout: 5000 });
  });

  test('can delete a card link via UI', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    const linkItem = linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Beta"))');
    await expect(linkItem).toBeVisible({ timeout: 5000 });

    await linkItem.locator('.link-delete-btn').click();

    await expect(linkItem).not.toBeVisible({ timeout: 5000 });
    await expect(linksSidebar.locator('.empty-text:has-text("No links")')).toBeVisible();
    await expect(linksSidebar.locator('label')).toContainText('Links (0)');
  });

  test('links label shows correct count when multiple links exist', async ({ page, request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Card Gamma', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
    })).json();

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });
    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardC.id, link_type: 'blocks' },
    });

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar.locator('label')).toContainText('Links (2)');
  });

  test('"Related" group label shown for relates_to links', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    await expect(page.locator('.links-sidebar .link-group-label:has-text("Related")')).toBeVisible({ timeout: 5000 });
  });

  test('link is visible from the target card perspective', async ({ page, request }) => {
    // The API returns links for both source and target, so opening Card Beta
    // after creating a link from Card Alpha should show the link.
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId, link_type: 'blocks' },
    });

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Beta');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar.locator('.link-item:has(.link-card-title:has-text("Card Alpha"))')).toBeVisible({ timeout: 5000 });
  });

  test('search input requires at least 2 characters before showing results', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    // Single character — results should NOT appear
    await linksSidebar.locator('.link-search-input').fill('C');
    await expect(linksSidebar.locator('.link-search-results')).not.toBeVisible();

    // Two characters — results may appear now
    await linksSidebar.locator('.link-search-input').fill('Ca');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
  });

  // Documents current backend behaviour: bidirectional perspective is not
  // automatically flipped. Both sides see the original link_type.
  test.fixme(
    'Card B shows "Blocked By" group when Card A blocks it (bidirectional perspective)',
    async ({ page, request }) => {
      const { token, boardId, cardAId, cardBId } = await setup(request);

      await request.post(`${BASE}/api/cards/${cardAId}/links`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { target_card_id: cardBId, link_type: 'blocks' },
      });

      await navigateToBoard(page, token, boardId);
      await openCardModal(page, 'Card Beta');

      // When Card A blocks Card B, Card B should show "Blocked By Card Alpha"
      await expect(page.locator('.links-sidebar .link-group-label:has-text("Blocked By")')).toBeVisible({ timeout: 5000 });
    },
  );
});
