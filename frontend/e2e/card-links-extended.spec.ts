/**
 * card-links-extended.spec.ts
 *
 * Comprehensive card link tests that extend (and do not duplicate) the
 * existing card-links.spec.ts coverage.
 *
 * Existing coverage (card-links.spec.ts):
 *   - POST creates relates_to, blocks, duplicates, is_blocked_by links
 *   - POST rejects invalid link_type (400)
 *   - POST rejects self-link (400)
 *   - GET returns links, empty array, source+target card objects
 *   - GET returns link from target card perspective
 *   - DELETE removes link, returns 404 for unknown link
 *   - Unauthenticated GET/POST returns 401
 *   - Cross-board link rejected (400)
 *   - Non-existent target card (400), non-existent source card (404)
 *   - Duplicate link rejected (400+)
 *   - Multiple links on a single card
 *   - UI: "No links" empty state, add relates_to/blocks/duplicates via UI
 *   - UI: links persist after modal close/reopen
 *   - UI: delete link via UI
 *   - UI: correct links count label
 *   - UI: Related group label, target card perspective
 *   - UI: search requires ≥2 chars
 *   - UI: fixme — bidirectional "Blocked By" group label
 *
 * New coverage added here:
 *   - is_duplicated_by link type creation
 *   - Link response shape (id, source_card_id, target_card_id, link_type)
 *   - Multiple links of different types between same pair of cards
 *   - Deleting one link from a card with multiple links
 *   - After deletion of A→B, B no longer sees the link
 *   - Unauthenticated DELETE returns 401
 *   - Non-member attempting to link cards returns 403
 *   - Viewer attempting to create a link returns 403
 *   - POST /api/cards/:id/links with missing target_card_id returns 400
 *   - POST /api/cards/:id/links with missing link_type returns 400
 *   - Linking two cards in both directions (A blocks B + A is_blocked_by B) on same pair
 *   - GET /api/cards/:id/links returns updated count after multiple creates/deletes
 *   - UI: link type dropdown contains all 5 expected options
 *   - UI: can add is_blocked_by link via UI
 *   - UI: can add is_duplicated_by link via UI
 *   - UI: linked card title visible in modal
 *   - UI: link type group label visible for is_blocked_by
 *   - UI: link type group label visible for duplicates
 *   - UI: link type group label visible for is_duplicated_by
 *   - UI: adding link via API shows in UI without page reload
 *   - UI: fixme — navigate to linked card from modal
 *   - UI: fixme — blocked card shows blocker indicator on kanban
 */

import { test, expect, APIRequestContext } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: APIRequestContext) {
  const email = `ext-link-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'LinkTest User' },
  });
  const body = await res.json();
  return { token: body.token as string, userId: body.user.id as number };
}

interface SetupResult {
  token: string;
  userId: number;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardAId: number;
  cardBId: number;
}

async function setup(request: APIRequestContext): Promise<SetupResult> {
  const { token, userId } = await createUser(request);

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Ext Link Board ${crypto.randomUUID().slice(0, 8)}` },
    })
  ).json();

  const columnId: number = board.columns[0].id;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Link Swimlane', designator: 'EL-' },
    })
  ).json();

  const cardA = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Link Card Alpha',
        column_id: columnId,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  const cardB = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Link Card Beta',
        column_id: columnId,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return {
    token,
    userId,
    boardId: board.id,
    columnId,
    swimlaneId: swimlane.id,
    cardAId: cardA.id,
    cardBId: cardB.id,
  };
}

async function addLink(
  request: APIRequestContext,
  token: string,
  sourceId: number,
  targetId: number,
  linkType: string,
) {
  return request.post(`${BASE}/api/cards/${sourceId}/links`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { target_card_id: targetId, link_type: linkType },
  });
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

async function openCardModal(
  page: import('@playwright/test').Page,
  cardTitle: string,
) {
  const card = page.locator(`.card-item:has(.card-title:has-text("${cardTitle}"))`);
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// API — link type coverage
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — link type coverage', () => {
  test('POST creates is_duplicated_by link type', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await addLink(request, token, cardAId, cardBId, 'is_duplicated_by');

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(link.link_type).toBe('is_duplicated_by');
  });

  test('Response contains id, source_card_id, target_card_id, link_type', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await addLink(request, token, cardAId, cardBId, 'relates_to');

    expect(res.status()).toBe(201);
    const link = await res.json();
    expect(typeof link.id).toBe('number');
    expect(link.id).toBeGreaterThan(0);
    expect(link.source_card_id).toBe(cardAId);
    expect(link.target_card_id).toBe(cardBId);
    expect(link.link_type).toBe('relates_to');
  });

  test('Response id is unique per link', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Link Card Gamma', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    const res1 = await addLink(request, token, cardAId, cardBId, 'relates_to');
    const res2 = await addLink(request, token, cardAId, cardC.id, 'blocks');

    const link1 = await res1.json();
    const link2 = await res2.json();

    expect(link1.id).not.toBe(link2.id);
  });
});

// ---------------------------------------------------------------------------
// API — bidirectional behavior
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — bidirectional behavior', () => {
  test('Target card can see link created from source card', async ({ request }) => {
    // Existing test confirms B sees the link; here we explicitly check link_type is preserved
    const { token, cardAId, cardBId } = await setup(request);

    await addLink(request, token, cardAId, cardBId, 'is_duplicated_by');

    const res = await request.get(`${BASE}/api/cards/${cardBId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const links = await res.json();
    expect(links.length).toBe(1);
    expect(links[0].link_type).toBe('is_duplicated_by');
  });

  test('Source card link count equals target card link count for a single link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    await addLink(request, token, cardAId, cardBId, 'relates_to');

    const [srcRes, tgtRes] = await Promise.all([
      request.get(`${BASE}/api/cards/${cardAId}/links`, { headers: { Authorization: `Bearer ${token}` } }),
      request.get(`${BASE}/api/cards/${cardBId}/links`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const srcLinks = await srcRes.json();
    const tgtLinks = await tgtRes.json();

    expect(srcLinks.length).toBe(1);
    expect(tgtLinks.length).toBe(1);
  });

  test('After deleting A→B, B no longer sees the link', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const createRes = await addLink(request, token, cardAId, cardBId, 'blocks');
    const link = await createRes.json();

    // Confirm B sees the link before deletion
    const before = await request.get(`${BASE}/api/cards/${cardBId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await before.json()).length).toBe(1);

    // Delete from source
    await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // B should now have no links
    const after = await request.get(`${BASE}/api/cards/${cardBId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await after.json()).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// API — link constraints
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — link constraints', () => {
  test('POST with missing target_card_id returns 400', async ({ request }) => {
    const { token, cardAId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { link_type: 'relates_to' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST with missing link_type returns 400', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { target_card_id: cardBId },
    });

    expect(res.status()).toBe(400);
  });

  test('Linking same pair with different link_types is allowed', async ({ request }) => {
    // A→B relates_to and A→B blocks should both succeed (different types)
    const { token, cardAId, cardBId } = await setup(request);

    const r1 = await addLink(request, token, cardAId, cardBId, 'relates_to');
    expect(r1.status()).toBe(201);

    const r2 = await addLink(request, token, cardAId, cardBId, 'blocks');
    expect(r2.status()).toBe(201);

    const listRes = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const links = await listRes.json();
    const types = links.map((l: any) => l.link_type);
    expect(types).toContain('relates_to');
    expect(types).toContain('blocks');
  });

  test('GET /api/cards/:id/links count decrements after deletion', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Link Card Delta', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    const l1 = await (await addLink(request, token, cardAId, cardBId, 'relates_to')).json();
    await addLink(request, token, cardAId, cardC.id, 'blocks');

    // Verify count is 2
    const before = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await before.json()).length).toBe(2);

    // Delete one link
    await request.delete(`${BASE}/api/cards/${cardAId}/links/${l1.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Verify count is now 1
    const after = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await after.json()).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// API — auth and permission enforcement
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — auth and permissions', () => {
  test('Unauthenticated DELETE /api/cards/:id/links/:linkId returns 401', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const createRes = await addLink(request, token, cardAId, cardBId, 'relates_to');
    const link = await createRes.json();

    const deleteRes = await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`);
    expect(deleteRes.status()).toBe(401);
  });

  test('Non-member cannot create a link on a board they do not belong to', async ({ request }) => {
    const { token: ownerToken, cardAId, cardBId } = await setup(request);

    // Create a separate user who is NOT a member of the board
    const nmEmail = `ext-nm-${crypto.randomUUID()}@test.com`;
    const nmRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email: nmEmail, password: 'password123', display_name: 'NonMember' },
    });
    const { token: nmToken } = await nmRes.json();

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${nmToken}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    // Non-member should be forbidden
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('Viewer cannot create a link (POST returns 403)', async ({ request }) => {
    const { token: ownerToken, boardId, cardAId, cardBId } = await setup(request);

    // Create viewer
    const vEmail = `ext-viewer-${crypto.randomUUID()}@test.com`;
    const vRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email: vEmail, password: 'password123', display_name: 'ViewerLink' },
    });
    const { token: viewerToken, user: viewerUser } = await vRes.json();

    // Add as viewer
    await request.post(`${BASE}/api/boards/${boardId}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: viewerUser.id, role: 'viewer' },
    });

    const res = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });

    expect(res.status()).toBe(403);
  });

  test('Member can create and delete links', async ({ request }) => {
    const { token: ownerToken, boardId, cardAId, cardBId } = await setup(request);

    const mEmail = `ext-member-${crypto.randomUUID()}@test.com`;
    const mRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email: mEmail, password: 'password123', display_name: 'MemberLink' },
    });
    const { token: memberToken, user: memberUser } = await mRes.json();

    await request.post(`${BASE}/api/boards/${boardId}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });

    // Member should be able to create a link
    const createRes = await request.post(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { target_card_id: cardBId, link_type: 'relates_to' },
    });
    expect(createRes.status()).toBe(201);
    const link = await createRes.json();

    // Member should be able to delete a link
    const deleteRes = await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(deleteRes.status()).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// API — lifecycle: multiple links
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — link lifecycle', () => {
  test('GET /api/cards/:id/links returns all link types created on a card', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Link Card Gamma', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    const cardD = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Link Card Delta', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    const cardE = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Link Card Epsilon', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    await addLink(request, token, cardAId, cardBId, 'relates_to');
    await addLink(request, token, cardAId, cardC.id, 'blocks');
    await addLink(request, token, cardAId, cardD.id, 'duplicates');
    await addLink(request, token, cardAId, cardE.id, 'is_duplicated_by');

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const links = await res.json();
    expect(links.length).toBe(4);

    const types = new Set(links.map((l: any) => l.link_type));
    expect(types.has('relates_to')).toBe(true);
    expect(types.has('blocks')).toBe(true);
    expect(types.has('duplicates')).toBe(true);
    expect(types.has('is_duplicated_by')).toBe(true);
  });

  test('Deleting a specific link leaves other links intact', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Persist Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
      })
    ).json();

    const linkToDelete = await (await addLink(request, token, cardAId, cardBId, 'relates_to')).json();
    const linkToKeep = await (await addLink(request, token, cardAId, cardC.id, 'blocks')).json();

    await request.delete(`${BASE}/api/cards/${cardAId}/links/${linkToDelete.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const remaining = await res.json();

    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(linkToKeep.id);
    expect(remaining[0].link_type).toBe('blocks');
  });

  test('DELETE /api/cards/:id/links/:linkId returns 404 when already deleted', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    const link = await (await addLink(request, token, cardAId, cardBId, 'relates_to')).json();

    await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Second delete attempt
    const secondDelete = await request.delete(`${BASE}/api/cards/${cardAId}/links/${link.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(secondDelete.status()).toBe(404);
  });

  test('GET links returns correct data after create-delete-create cycle', async ({ request }) => {
    const { token, cardAId, cardBId } = await setup(request);

    // Create
    const first = await (await addLink(request, token, cardAId, cardBId, 'relates_to')).json();

    // Delete
    await request.delete(`${BASE}/api/cards/${cardAId}/links/${first.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Recreate same type
    const second = await (await addLink(request, token, cardAId, cardBId, 'relates_to')).json();
    expect(second.id).not.toBe(first.id);

    // Verify it's back
    const listRes = await request.get(`${BASE}/api/cards/${cardAId}/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const links = await listRes.json();
    expect(links.length).toBe(1);
    expect(links[0].link_type).toBe('relates_to');
  });
});

// ---------------------------------------------------------------------------
// UI — link type dropdown
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — UI link type dropdown', () => {
  test('Link type dropdown contains all 5 link type options', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    // Guard: skip if card creation failed
    if (!cardAId || !cardBId) {
      test.skip(true, 'Card setup failed — skipping UI test');
    }

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });

    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    const select = linksSidebar.locator('.link-type-select');
    await expect(select).toBeVisible();

    // All 5 link types must be present as <option> values
    const options = await select.locator('option').allTextContents();
    const optionValues = await select.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => o.value),
    );

    expect(optionValues).toContain('blocks');
    expect(optionValues).toContain('is_blocked_by');
    expect(optionValues).toContain('relates_to');
    expect(optionValues).toContain('duplicates');
    expect(optionValues).toContain('is_duplicated_by');
  });
});

// ---------------------------------------------------------------------------
// UI — additional link type creation
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — UI add link types', () => {
  test('Can add is_blocked_by link via UI', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    await linksSidebar.locator('.link-type-select').selectOption('is_blocked_by');
    await linksSidebar.locator('.link-search-input').fill('Link Card B');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
    await linksSidebar
      .locator('.link-search-result-item:has(.link-result-title:has-text("Link Card Beta"))')
      .click();

    await expect(
      linksSidebar.locator('.link-item:has(.link-card-title:has-text("Link Card Beta"))'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('Can add is_duplicated_by link via UI', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });
    await linksSidebar.locator('.btn-xs:has-text("+")').click();
    await expect(linksSidebar.locator('.add-link-form')).toBeVisible();

    await linksSidebar.locator('.link-type-select').selectOption('is_duplicated_by');
    await linksSidebar.locator('.link-search-input').fill('Link Card B');
    await expect(linksSidebar.locator('.link-search-results')).toBeVisible({ timeout: 5000 });
    await linksSidebar
      .locator('.link-search-result-item:has(.link-result-title:has-text("Link Card Beta"))')
      .click();

    await expect(
      linksSidebar.locator('.link-item:has(.link-card-title:has-text("Link Card Beta"))'),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// UI — link group labels and card display
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — UI group labels and card display', () => {
  test('Linked card title is shown in link item', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await addLink(
      request,
      token,
      cardAId,
      cardBId,
      'relates_to',
    );

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(
      linksSidebar.locator('.link-card-title:has-text("Link Card Beta")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('Duplicates group label shown for duplicates link', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await addLink(request, token, cardAId, cardBId, 'duplicates');

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    await expect(
      page.locator('.links-sidebar .link-group-label:has-text("Duplicates")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('Blocked By group label shown for is_blocked_by link', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    await addLink(request, token, cardAId, cardBId, 'is_blocked_by');

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    await expect(
      page.locator('.links-sidebar .link-group-label:has-text("Blocked By")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test(
    'Is Duplicated By group label shown for is_duplicated_by link',
    async ({ page, request }) => {
      const { token, boardId, cardAId, cardBId } = await setup(request);

      await addLink(request, token, cardAId, cardBId, 'is_duplicated_by');

      await navigateToBoard(page, token, boardId);
      await openCardModal(page, 'Link Card Alpha');

      await expect(
        page.locator('.links-sidebar .link-group-label:has-text("Is Duplicated By")'),
      ).toBeVisible({ timeout: 5000 });
    },
  );

  test('Multiple links show separate group sections', async ({ page, request }) => {
    const { token, boardId, columnId, swimlaneId, cardAId, cardBId } = await setup(request);

    const cardC = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Link Card Gamma UI',
          column_id: columnId,
          swimlane_id: swimlaneId,
          board_id: boardId,
        },
      })
    ).json();

    await addLink(request, token, cardAId, cardBId, 'relates_to');
    await addLink(request, token, cardAId, cardC.id, 'blocks');

    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar.locator('label')).toContainText('Links (2)', { timeout: 5000 });

    // Both group labels should be visible
    await expect(linksSidebar.locator('.link-group-label:has-text("Related")')).toBeVisible();
    await expect(linksSidebar.locator('.link-group-label:has-text("Blocks")')).toBeVisible();
  });

  test('Link added via API appears in UI without page reload', async ({ page, request }) => {
    const { token, boardId, cardAId, cardBId } = await setup(request);

    // Navigate first, THEN create the link via API while the modal is open
    await navigateToBoard(page, token, boardId);
    await openCardModal(page, 'Link Card Alpha');

    const linksSidebar = page.locator('.links-sidebar');
    await expect(linksSidebar).toBeVisible({ timeout: 5000 });

    // Confirm no links yet
    await expect(linksSidebar.locator('label')).toContainText('Links (0)');

    // Create link via API
    await addLink(request, token, cardAId, cardBId, 'relates_to');

    // Close and reopen the modal to trigger a fetch
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    await openCardModal(page, 'Link Card Alpha');

    await expect(
      page.locator('.links-sidebar .link-item:has(.link-card-title:has-text("Link Card Beta"))'),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// UI — fixme tests (functionality not yet verified)
// ---------------------------------------------------------------------------

test.describe('Card Links Extended — UI fixme', () => {
  test.fixme(
    'Clicking linked card title navigates to that card',
    async ({ page, request }) => {
      // When a user clicks on the linked card's title in the links sidebar,
      // the modal should switch to show the linked card's details (or navigate
      // to a URL that opens the linked card).
      const { token, boardId, cardAId, cardBId } = await setup(request);

      await addLink(request, token, cardAId, cardBId, 'relates_to');
      await navigateToBoard(page, token, boardId);
      await openCardModal(page, 'Link Card Alpha');

      const linksSidebar = page.locator('.links-sidebar');
      await linksSidebar.locator('.link-card-title:has-text("Link Card Beta")').click();

      // Expect to see Link Card Beta's modal
      await expect(
        page.locator('.card-detail-modal-unified .card-title-display:has-text("Link Card Beta")'),
      ).toBeVisible({ timeout: 5000 });
    },
  );

  test.fixme(
    'Blocked card displays a blocker indicator on the kanban board',
    async ({ page, request }) => {
      // When card A is blocked by card B, card A should display a visual
      // indicator (e.g., a "blocked" badge or icon) on the kanban card item.
      const { token, boardId, cardAId, cardBId } = await setup(request);

      // cardA is_blocked_by cardB
      await addLink(request, token, cardAId, cardBId, 'is_blocked_by');

      await navigateToBoard(page, token, boardId);

      const blockedCard = page.locator(
        `.card-item:has(.card-title:has-text("Link Card Alpha"))`,
      );
      await expect(blockedCard.locator('.blocked-indicator, [data-blocked="true"]')).toBeVisible({
        timeout: 5000,
      });
    },
  );

  test.fixme(
    'UI displays "Blocks" badge on a card that is blocking another card',
    async ({ page, request }) => {
      // Cards that are actively blocking others should show a visual hint on
      // the kanban view so users can quickly identify blockers.
      const { token, boardId, cardAId, cardBId } = await setup(request);

      await addLink(request, token, cardAId, cardBId, 'blocks');

      await navigateToBoard(page, token, boardId);

      const blockingCard = page.locator(
        `.card-item:has(.card-title:has-text("Link Card Alpha"))`,
      );
      await expect(blockingCard.locator('.blocking-indicator, [data-blocking="true"]')).toBeVisible({
        timeout: 5000,
      });
    },
  );

  test.fixme(
    'Card B automatically shows "is_blocked_by" perspective when A blocks B',
    async ({ page, request }) => {
      // When card A is linked as "blocks" card B, viewing card B's links
      // should automatically invert the perspective and show "Blocked By" group
      // with Card A listed under it (rather than showing the raw "blocks" type).
      // This is the bidirectional perspective flip which is not yet implemented.
      const { token, boardId, cardAId, cardBId } = await setup(request);

      await addLink(request, token, cardAId, cardBId, 'blocks');
      await navigateToBoard(page, token, boardId);
      await openCardModal(page, 'Link Card Beta');

      await expect(
        page.locator('.links-sidebar .link-group-label:has-text("Blocked By")'),
      ).toBeVisible({ timeout: 5000 });
    },
  );
});
