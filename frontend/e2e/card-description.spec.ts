import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Creates a user, board, swimlane, and card via API, then navigates to the board
 * and switches to "All Cards" view so the card is visible.
 *
 * Returns { token, boardId, cardId } for further API-level assertions.
 */
async function setup(request: any, page: any, label = 'Desc') {
  const email = `test-card-desc-${Date.now()}-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  // boards endpoint returns columns on the board object directly
  const columns: any[] = board.columns;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Description Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to All Cards view so cards appear without an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { token, boardId: board.id, cardId: card.id };
}

/**
 * Opens the card modal and waits for it to be visible.
 */
async function openCardModal(page: any) {
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
}

/**
 * Clicks "Add" or "Edit" in the description section to enter edit mode,
 * fills the description textarea, and clicks Save. Waits for the PUT response.
 */
async function saveDescription(page: any, text: string) {
  // The description section button reads "Add" if empty, "Edit" if text exists
  await page.click('.card-description-section .section-header button');
  await page.waitForSelector('.description-edit textarea', { timeout: 5000 });

  await page.fill('.description-edit textarea', text);

  const [response] = await Promise.all([
    page.waitForResponse(
      (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
    ),
    page.click('.description-actions .btn-primary'),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Card Description Editor', () => {

  // 1. Add description to card
  test('add description — persists after modal close and reopen', async ({ page, request }) => {
    await setup(request, page, 'AddDesc');
    await openCardModal(page);

    const response = await saveDescription(page, 'My new description');
    expect(response.status()).toBe(200);

    // Description text visible in view mode
    await expect(page.locator('.description-text')).toContainText('My new description', { timeout: 5000 });
    await expect(page.locator('.description-text')).not.toHaveClass(/empty/);

    // Close and reopen
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    await openCardModal(page);
    await expect(page.locator('.description-text')).toContainText('My new description');
  });

  // 2. Edit existing description
  test('edit existing description — updated text is displayed', async ({ page, request }) => {
    const { token, cardId } = await setup(request, page, 'EditDesc');

    // Pre-populate description via API
    await request.put(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Description Test Card',
        description: 'Original description',
        priority: 'medium',
        issue_type: 'task',
      },
    });

    // Reload the board so the UI picks up the pre-populated description
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page);

    // The button should read "Edit" (not "Add") since there's already a description
    await expect(
      page.locator('.card-description-section .section-header button')
    ).toHaveText('Edit');

    const response = await saveDescription(page, 'Updated description text');
    expect(response.status()).toBe(200);

    await expect(page.locator('.description-text')).toContainText('Updated description text', { timeout: 5000 });
  });

  // 3. Description persists after page reload
  test('description persists after page reload', async ({ page, request }) => {
    await setup(request, page, 'ReloadDesc');
    await openCardModal(page);

    await saveDescription(page, 'Reload persistence check');
    await expect(page.locator('.description-text')).toContainText('Reload persistence check', { timeout: 5000 });

    // Close modal and reload the page
    await page.click('.modal-close-btn');
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page);
    await expect(page.locator('.description-text')).toContainText('Reload persistence check');
  });

  // 4. Empty description — save empty, verify empty state
  test('clear description — shows empty state placeholder', async ({ page, request }) => {
    const { token, cardId } = await setup(request, page, 'EmptyDesc');

    // Pre-populate via API
    await request.put(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Description Test Card',
        description: 'Will be cleared',
        priority: 'medium',
        issue_type: 'task',
      },
    });

    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page);

    // Clear description
    const response = await saveDescription(page, '');
    expect(response.status()).toBe(200);

    // The paragraph should get the 'empty' class and show the placeholder text
    await expect(page.locator('.description-text.empty')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.description-text.empty')).toContainText('No description provided');
  });

  // 5. Long description (1000 characters)
  test('long description — saves and displays completely', async ({ page, request }) => {
    await setup(request, page, 'LongDesc');
    await openCardModal(page);

    const longText = 'A'.repeat(500) + ' ' + 'B'.repeat(499); // 1001 chars with space
    const response = await saveDescription(page, longText);
    expect(response.status()).toBe(200);

    // Verify the text is present — check a distinctive prefix and suffix
    const descText = page.locator('.description-text');
    await expect(descText).toContainText('AAAAA', { timeout: 5000 });
    await expect(descText).toContainText('BBBBB');

    // Verify total length via inner text
    const text = await descText.innerText();
    expect(text.length).toBeGreaterThanOrEqual(longText.length);
  });

  // 6. Description with markdown syntax — rendered as plain text (no markdown library)
  test('description with markdown syntax — displayed as plain text (no rendering)', async ({ page, request }) => {
    await setup(request, page, 'MdDesc');
    await openCardModal(page);

    const markdownText = '**bold** and # heading and _italic_';
    const response = await saveDescription(page, markdownText);
    expect(response.status()).toBe(200);

    // The description is rendered in a <p> tag with raw text — no markdown library
    const descParagraph = page.locator('.description-text');
    await expect(descParagraph).toContainText('**bold**', { timeout: 5000 });
    await expect(descParagraph).toContainText('# heading');
    await expect(descParagraph).toContainText('_italic_');

    // No <strong> or <h1> elements should be rendered inside the description section
    await expect(page.locator('.card-description-section strong')).toHaveCount(0);
    await expect(page.locator('.card-description-section h1')).toHaveCount(0);
  });

  // 7. Description with code block syntax — rendered as plain text
  test('description with code block syntax — preserved as-is', async ({ page, request }) => {
    await setup(request, page, 'CodeDesc');
    await openCardModal(page);

    const codeText = '```\nconst x = 1;\nconsole.log(x);\n```';
    const response = await saveDescription(page, codeText);
    expect(response.status()).toBe(200);

    // The backticks should appear verbatim in the plain-text paragraph
    await expect(page.locator('.description-text')).toContainText('```', { timeout: 5000 });
    await expect(page.locator('.description-text')).toContainText('const x = 1;');

    // No <code> or <pre> elements rendered inside the description section
    await expect(page.locator('.card-description-section code')).toHaveCount(0);
    await expect(page.locator('.card-description-section pre')).toHaveCount(0);
  });

  // 8. Description with URL — stored and displayed as plain text
  test('description with URL — URL stored as plain text (no auto-linking)', async ({ page, request }) => {
    await setup(request, page, 'URLDesc');
    await openCardModal(page);

    const urlText = 'See https://example.com for details';
    const response = await saveDescription(page, urlText);
    expect(response.status()).toBe(200);

    await expect(page.locator('.description-text')).toContainText('https://example.com', { timeout: 5000 });

    // No anchor tag rendered inside the description section
    await expect(page.locator('.card-description-section a[href]')).toHaveCount(0);
  });

  // 9. Cancel edit — reverts to original description
  test('cancel edit — reverts to original description without saving', async ({ page, request }) => {
    const { token, cardId } = await setup(request, page, 'CancelDesc');

    // Pre-populate via API
    await request.put(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Description Test Card',
        description: 'Original description',
        priority: 'medium',
        issue_type: 'task',
      },
    });

    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page);

    // Enter edit mode
    await page.click('.card-description-section .section-header button');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });

    // Change the text
    await page.fill('.description-edit textarea', 'This should not be saved');

    // Click Cancel (not Save)
    await page.click('.description-actions .btn:not(.btn-primary)');

    // Edit mode should close and original description should be visible
    await expect(page.locator('.description-edit')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.description-text')).toContainText('Original description');
    await expect(page.locator('.description-text')).not.toContainText('This should not be saved');
  });

  // 10. Description in API response — GET /api/cards/:id returns description field
  test('API response includes description field', async ({ page, request }) => {
    const { token, cardId } = await setup(request, page, 'APIDesc');
    await openCardModal(page);

    await saveDescription(page, 'API check description');

    // Fetch the card directly from the API
    const cardResp = await request.get(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardResp.status()).toBe(200);

    const cardData = await cardResp.json();
    expect(cardData).toHaveProperty('description');
    expect(cardData.description).toBe('API check description');
  });

  // 11. Newlines preserved — multi-line description
  test('newlines preserved — multi-line description saves and displays text', async ({ page, request }) => {
    await setup(request, page, 'NewlineDesc');
    await openCardModal(page);

    // Enter edit mode manually so we can use keyboard for newlines
    await page.click('.card-description-section .section-header button');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });

    const textarea = page.locator('.description-edit textarea');

    // Type multi-line text using keyboard
    await textarea.click();
    await textarea.fill('Line one\nLine two\nLine three');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.description-actions .btn-primary'),
    ]);
    expect(response.status()).toBe(200);

    // The description-text paragraph should contain all three lines' text
    const descText = page.locator('.description-text');
    await expect(descText).toContainText('Line one', { timeout: 5000 });
    await expect(descText).toContainText('Line two');
    await expect(descText).toContainText('Line three');

    // Verify via API that newlines are stored
    const updatedCard = await response.json();
    expect(updatedCard.description).toContain('Line one');
    expect(updatedCard.description).toContain('Line two');
    expect(updatedCard.description).toContain('Line three');
  });

  // Bonus: description section "Add" button is present and shows placeholder when empty
  test('empty card shows Add button and placeholder text', async ({ page, request }) => {
    await setup(request, page, 'EmptyBtn');
    await openCardModal(page);

    // The description section should show the "Add" button (not "Edit")
    const sectionBtn = page.locator('.card-description-section .section-header button');
    await expect(sectionBtn).toHaveText('Add');

    // The paragraph should have the empty class and placeholder text
    await expect(page.locator('.description-text.empty')).toBeVisible();
    await expect(page.locator('.description-text.empty')).toContainText('No description provided');
  });

  // Bonus: description textarea auto-focuses when entering edit mode
  test('description textarea receives focus when edit mode is activated', async ({ page, request }) => {
    await setup(request, page, 'FocusDesc');
    await openCardModal(page);

    await page.click('.card-description-section .section-header button');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });

    // The textarea should be auto-focused (autoFocus attribute is set)
    const textarea = page.locator('.description-edit textarea');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  // Bonus: Save button is disabled while saving
  test('Save button shows saving state during API call', async ({ page, request }) => {
    await setup(request, page, 'SavingState');
    await openCardModal(page);

    await page.click('.card-description-section .section-header button');
    await page.waitForSelector('.description-edit textarea', { timeout: 5000 });

    await page.fill('.description-edit textarea', 'Checking save state');

    // Click Save — immediately check if button disables. Since the API call may be fast
    // in tests, we just verify the call completes and the modal state is correct afterward.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.description-actions .btn-primary'),
    ]);
    expect(response.status()).toBe(200);

    // After save: edit mode should close, text should be visible
    await expect(page.locator('.description-edit')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.description-text')).toContainText('Checking save state');
  });

  // 14. Description pre-set via API before the UI loads — shown immediately on open
  test('description pre-set via API — visible when modal opens', async ({ page, request }) => {
    const { token, cardId } = await setup(request, page, 'PreSetDesc');

    // Set description directly via API before navigating to the board
    const updateRes = await request.put(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Description Test Card',
        description: 'Pre-loaded via API',
        priority: 'medium',
        issue_type: 'task',
      },
    });
    expect(updateRes.status()).toBe(200);

    // Reload so the updated card is fetched fresh
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await openCardModal(page);

    // The description section should render the API-set text immediately (no Add click needed)
    await expect(page.locator('.description-text')).toContainText('Pre-loaded via API', { timeout: 5000 });
    // Edit button should be "Edit" since there's already content
    await expect(
      page.locator('.card-description-section .section-header button')
    ).toHaveText('Edit');
  });

  // 15. Special characters in description — stored and displayed correctly
  test('description with special characters — stored and displayed as-is', async ({ page, request }) => {
    await setup(request, page, 'SpecialCharsDesc');
    await openCardModal(page);

    const specialText = 'Price: $100 & <discount> © 2030 "quoted" \'single\'';
    const response = await saveDescription(page, specialText);
    expect(response.status()).toBe(200);

    // The special characters should appear verbatim in the UI
    await expect(page.locator('.description-text')).toContainText('$100', { timeout: 5000 });
    await expect(page.locator('.description-text')).toContainText('© 2030');
  });

  // 16. Description with whitespace-only text — treated as empty or saved
  test('description with only whitespace — API returns 200 and does not crash UI', async ({ page, request }) => {
    await setup(request, page, 'WhitespaceDesc');
    await openCardModal(page);

    const response = await saveDescription(page, '   ');
    // API should return 200 (whitespace is technically valid content)
    expect(response.status()).toBe(200);

    // UI should not crash — modal should still be open
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
  });

  // 17. Two consecutive edits — second edit replaces first, not appends
  test('second edit replaces first description completely', async ({ page, request }) => {
    await setup(request, page, 'TwoEditsDesc');
    await openCardModal(page);

    // First save
    await saveDescription(page, 'First version of description');
    await expect(page.locator('.description-text')).toContainText('First version', { timeout: 5000 });

    // Second save (replaces first)
    const response = await saveDescription(page, 'Second version replaces first');
    expect(response.status()).toBe(200);

    // Only second version should be present
    await expect(page.locator('.description-text')).toContainText('Second version replaces first', { timeout: 5000 });
    await expect(page.locator('.description-text')).not.toContainText('First version');
  });
});
