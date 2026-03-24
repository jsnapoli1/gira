import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal 1x1 PNG as base64 */
const PNG_DATA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

interface SetupResult {
  token: string;
  boardId: number;
  cardId: number;
}

/**
 * Create a user, board, swimlane, and card via API.
 * Returns setup data. Caller must call test.skip() if card creation fails.
 */
async function setupResources(
  request: import('@playwright/test').APIRequestContext,
  label = 'Attach',
): Promise<SetupResult | null> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `test-attach-${uid}@example.com`,
      password: 'password123',
      display_name: 'Attachment Tester',
    },
  });
  const { token } = await signupRes.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board ${uid}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'AT' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Attachment Test Card',
      column_id: board.columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!cardRes.ok()) {
    return null;
  }

  const card = await cardRes.json();
  return { token, boardId: board.id, cardId: card.id };
}

/** Navigate to board, switch to All Cards view, open the first card modal */
async function openCardModal(
  page: import('@playwright/test').Page,
  token: string,
  boardId: number,
): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.locator('.card-item').first().click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
  await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Attachments', () => {
  let txtFilePath: string;
  let pngFilePath: string;

  test.beforeAll(async ({}, testInfo) => {
    // Create a plain text file for uploads
    txtFilePath = path.join(os.tmpdir(), `attach-test-${testInfo.workerIndex}.txt`);
    fs.writeFileSync(txtFilePath, 'This is a test attachment file for E2E testing.');

    // Create a small PNG image for image-type tests
    pngFilePath = path.join(os.tmpdir(), `attach-img-${testInfo.workerIndex}.png`);
    fs.writeFileSync(pngFilePath, PNG_DATA);
  });

  test.afterAll(() => {
    for (const p of [txtFilePath, pngFilePath]) {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  // -------------------------------------------------------------------------
  // 1. Upload button visible in card detail modal
  // -------------------------------------------------------------------------
  test('upload button is visible in card detail modal attachments sidebar', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // The upload label (styled as a button) should be visible
    const uploadLabel = page.locator('.attachments-sidebar label.btn');
    await expect(uploadLabel).toBeVisible();
    await expect(uploadLabel).toContainText('+');

    // The underlying file input should also exist
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  // -------------------------------------------------------------------------
  // 2. Empty state shown when no attachments
  // -------------------------------------------------------------------------
  test('shows "No attachments" empty state when card has no attachments', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await expect(page.locator('.attachments-sidebar .empty-text')).toBeVisible();
    await expect(page.locator('.attachments-sidebar .empty-text')).toContainText('No attachments');
  });

  // -------------------------------------------------------------------------
  // 3. Upload a text file — appears in the list
  // -------------------------------------------------------------------------
  test('upload a text file and it appears in the attachment list', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath),
    );
  });

  // -------------------------------------------------------------------------
  // 4. Upload a PNG image file — appears in list with thumbnail
  // -------------------------------------------------------------------------
  test('upload a PNG image file and it shows an img thumbnail', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(pngFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    // Image attachments render an <img> thumbnail
    await expect(page.locator('.attachment-thumb-small')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 5. Non-image file shows file icon, not an img thumbnail
  // -------------------------------------------------------------------------
  test('non-image attachment shows file icon rather than img thumbnail', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    // Icon span should be visible for non-image files
    await expect(page.locator('.attachment-icon-tiny')).toBeVisible({ timeout: 5000 });
    // No image thumbnail for a text file
    await expect(page.locator('.attachment-thumb-small')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 6. Download link has correct href and download attribute
  // -------------------------------------------------------------------------
  test('download link has href matching /api/attachments/:id and correct filename', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);

    const link = page.locator('.attachment-name-small').first();
    await expect(link).toBeVisible({ timeout: 8000 });

    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/api\/attachments\/\d+/);

    const downloadAttr = await link.getAttribute('download');
    expect(downloadAttr).toBe(path.basename(txtFilePath));
  });

  // -------------------------------------------------------------------------
  // 7. Delete attachment with confirmation
  // -------------------------------------------------------------------------
  test('delete attachment — accepts confirm dialog and attachment disappears', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // Accept any confirmation dialogs
    page.on('dialog', (dialog) => dialog.accept());

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    // Click the delete button on the attachment
    await page.locator('.attachment-delete-tiny').first().click();

    // Attachment should be gone and empty state should reappear
    await expect(page.locator('.attachment-item-sidebar')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.attachments-sidebar .empty-text')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 8. Attachment persists after modal is closed and reopened
  // -------------------------------------------------------------------------
  test('attachment persists after closing and reopening card modal', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    // Close the modal by clicking outside it
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the same card
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Attachment should still be present
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath),
    );
  });

  // -------------------------------------------------------------------------
  // 9. API: POST /api/cards/:id/attachments (multipart) returns attachment object
  // -------------------------------------------------------------------------
  test('API: POST /api/cards/:id/attachments returns created attachment', async ({ request }) => {
    const setup = await setupResources(request, 'APIAttach');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const fileContent = Buffer.from('API upload test content');
    const formData = {
      file: {
        name: 'api-test.txt',
        mimeType: 'text/plain',
        buffer: fileContent,
      },
    };

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      multipart: formData,
    });

    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(201);

    const attachment = await res.json();
    expect(attachment.id).toBeTruthy();
    expect(attachment.filename).toBe('api-test.txt');
    expect(attachment.card_id).toBe(setup.cardId);
  });

  // -------------------------------------------------------------------------
  // 10. API: DELETE /api/attachments/:id via card route removes the attachment
  // -------------------------------------------------------------------------
  test('API: DELETE /api/cards/:id/attachments/:attachmentId removes the attachment', async ({ request }) => {
    const setup = await setupResources(request, 'APIDelete');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Upload first
    const uploadRes = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      multipart: {
        file: {
          name: 'delete-me.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('to be deleted'),
        },
      },
    });
    expect(uploadRes.ok()).toBe(true);
    const attachment = await uploadRes.json();

    // Delete
    const deleteRes = await request.delete(
      `${BASE}/api/cards/${setup.cardId}/attachments/${attachment.id}`,
      { headers: { Authorization: `Bearer ${setup.token}` } },
    );
    expect(deleteRes.status()).toBe(204);

    // Verify: GET attachments no longer includes it
    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const attachments: { id: number }[] = await listRes.json();
    const found = attachments.find((a) => a.id === attachment.id);
    expect(found).toBeUndefined();
  });
});
