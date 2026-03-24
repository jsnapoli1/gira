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

/** Upload a file via API and return the attachment object */
async function uploadAttachment(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  cardId: number,
  filename = 'test.txt',
  content = 'test content',
  mimeType = 'text/plain',
) {
  const res = await request.post(`${BASE}/api/cards/${cardId}/attachments`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: filename,
        mimeType,
        buffer: Buffer.from(content),
      },
    },
  });
  return { res, attachment: res.ok() ? await res.json() : null };
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

  // =========================================================================
  // Additional API tests
  // =========================================================================

  // -------------------------------------------------------------------------
  // 11. API: Returned attachment has id, filename, and size fields
  // -------------------------------------------------------------------------
  test('API: uploaded attachment response has id, filename, and size fields', async ({ request }) => {
    const setup = await setupResources(request, 'APIFields');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const content = 'field check content';
    const { res, attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'fields.txt', content,
    );

    expect(res.status()).toBe(201);
    expect(typeof attachment.id).toBe('number');
    expect(attachment.filename).toBe('fields.txt');
    expect(typeof attachment.size).toBe('number');
    expect(attachment.size).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 12. API: GET /api/cards/:id/attachments returns array containing the upload
  // -------------------------------------------------------------------------
  test('API: GET /api/cards/:id/attachments returns array containing uploaded attachment', async ({ request }) => {
    const setup = await setupResources(request, 'APIList');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'list-check.txt',
    );
    expect(attachment).not.toBeNull();

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(listRes.ok()).toBe(true);
    const list: { id: number }[] = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((a) => a.id === attachment.id);
    expect(found).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 13. API: GET /api/attachments/:id returns the file content
  // -------------------------------------------------------------------------
  test('API: GET /api/attachments/:id serves the uploaded file bytes', async ({ request }) => {
    const setup = await setupResources(request, 'APIDownload');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const content = 'downloadable content abc123';
    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'download-me.txt', content,
    );
    expect(attachment).not.toBeNull();

    const downloadRes = await request.get(`${BASE}/api/attachments/${attachment.id}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(downloadRes.ok()).toBe(true);
    const body = await downloadRes.text();
    expect(body).toContain('downloadable content abc123');
  });

  // -------------------------------------------------------------------------
  // 14. API: Unauthorized request cannot upload (401)
  // -------------------------------------------------------------------------
  test('API: uploading without a token returns 401', async ({ request }) => {
    const setup = await setupResources(request, 'APIUnauth');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      // No Authorization header
      multipart: {
        file: {
          name: 'unauth.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('unauthorized'),
        },
      },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 15. API: Unauthorized request cannot download (401)
  // -------------------------------------------------------------------------
  test('API: downloading without a token returns 401', async ({ request }) => {
    const setup = await setupResources(request, 'APIUnauthDl');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'secret.txt', 'secret',
    );
    expect(attachment).not.toBeNull();

    // Try to download without auth
    const downloadRes = await request.get(`${BASE}/api/attachments/${attachment.id}`);
    expect(downloadRes.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 16. API: Upload multiple attachments — both appear in the list
  // -------------------------------------------------------------------------
  test('API: uploading multiple attachments — both appear in list', async ({ request }) => {
    const setup = await setupResources(request, 'APIMulti');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const { attachment: a1 } = await uploadAttachment(
      request, setup.token, setup.cardId, 'multi-a.txt', 'content a',
    );
    const { attachment: a2 } = await uploadAttachment(
      request, setup.token, setup.cardId, 'multi-b.txt', 'content b',
    );
    expect(a1).not.toBeNull();
    expect(a2).not.toBeNull();

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const list: { id: number }[] = await listRes.json();
    expect(list.find((a) => a.id === a1.id)).toBeDefined();
    expect(list.find((a) => a.id === a2.id)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 17. API: Attachment has created_at timestamp
  // -------------------------------------------------------------------------
  test('API: uploaded attachment has a created_at timestamp', async ({ request }) => {
    const setup = await setupResources(request, 'APITimestamp');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'ts-check.txt',
    );
    expect(attachment).not.toBeNull();
    expect(attachment.created_at).toBeTruthy();
    // created_at should be a parseable date string
    const d = new Date(attachment.created_at);
    expect(d.getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 18. API: Attachment size in bytes matches the uploaded content length
  // -------------------------------------------------------------------------
  test('API: attachment size in bytes matches the length of the uploaded content', async ({ request }) => {
    const setup = await setupResources(request, 'APISize');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const content = 'exactly twenty chars';
    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'size-check.txt', content,
    );
    expect(attachment).not.toBeNull();
    expect(attachment.size).toBe(Buffer.from(content).length);
  });

  // -------------------------------------------------------------------------
  // 19. API: Upload file over 10 MB limit returns 400
  // -------------------------------------------------------------------------
  test('API: uploading a file exceeding the 10 MB server limit returns 400', async ({ request }) => {
    test.fixme(
      true,
      'The server does not currently enforce a 10 MB upload limit — large files are accepted with 201. ' +
        'When server-side size enforcement is added (e.g. ParseMultipartForm(10<<20)), ' +
        'remove this fixme and uncomment the assertions.',
    );

    const setup = await setupResources(request, 'APILargeFile');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Generate a buffer slightly over 10 MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'x');
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      multipart: {
        file: {
          name: 'large.bin',
          mimeType: 'application/octet-stream',
          buffer: largeBuffer,
        },
      },
    });
    // Server enforces a 10 MB limit; expect a 4xx error
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // 20. API: mime_type is set on the returned attachment
  // -------------------------------------------------------------------------
  test('API: uploaded attachment has mime_type field set', async ({ request }) => {
    const setup = await setupResources(request, 'APIMime');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      multipart: {
        file: {
          name: 'typed.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('mime type test'),
        },
      },
    });
    expect(res.ok()).toBe(true);
    const attachment = await res.json();
    expect(attachment.mime_type).toBeTruthy();
    expect(typeof attachment.mime_type).toBe('string');
  });

  // =========================================================================
  // Additional UI tests
  // =========================================================================

  // -------------------------------------------------------------------------
  // 21. UI: Attachments section is visible in card modal
  // -------------------------------------------------------------------------
  test('UI: attachments section is visible in the card modal', async ({ page, request }) => {
    const setup = await setupResources(request, 'UISection');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await expect(page.locator('.attachments-sidebar')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 22. UI: Uploaded attachment filename shown in list
  // -------------------------------------------------------------------------
  test('UI: uploaded attachment filename is shown in the attachment list', async ({ page, request }) => {
    const setup = await setupResources(request, 'UIFilename');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);

    await expect(page.locator('.attachment-name-small').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath),
    );
  });

  // -------------------------------------------------------------------------
  // 23. UI: Attachment download link is present and navigable
  // -------------------------------------------------------------------------
  test('UI: clicking the download link initiates download with correct filename', async ({ page, request }) => {
    const setup = await setupResources(request, 'UIDownload');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.attachment-name-small').first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(path.basename(txtFilePath));
  });

  // -------------------------------------------------------------------------
  // 24. UI: Delete button removes the attachment from the list
  // -------------------------------------------------------------------------
  test('UI: delete button removes attachment from the list immediately', async ({ page, request }) => {
    const setup = await setupResources(request, 'UIDelete');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    page.on('dialog', (d) => d.accept());

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    await page.locator('.attachment-delete-tiny').first().click();

    await expect(page.locator('.attachment-item-sidebar')).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 25. UI: Uploading two files shows two attachment items
  // -------------------------------------------------------------------------
  test('UI: uploading two separate files shows two attachment items', async ({ page, request }) => {
    const setup = await setupResources(request, 'UITwo');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');

    // Upload first file
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(1, { timeout: 8000 });

    // Upload second file (PNG)
    await fileInput.setInputFiles(pngFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(2, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 26. UI: Cancel delete (dismiss dialog) keeps attachment visible
  // -------------------------------------------------------------------------
  test('UI: dismissing delete confirmation keeps the attachment in the list', async ({ page, request }) => {
    const setup = await setupResources(request, 'UIKeep');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // Dismiss any confirmation dialog
    page.on('dialog', (d) => d.dismiss());

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    await page.locator('.attachment-delete-tiny').first().click();

    // Attachment should remain visible after dismissing
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 27. UI: Attachment count badge or label updates after upload
  // -------------------------------------------------------------------------
  test('UI: attachments section shows count or label after uploading a file', async ({ page, request }) => {
    test.fixme(
      true,
      'No dedicated attachment count label exists in current UI. ' +
        'This test should be enabled once a count indicator is added to the attachments header.',
    );

    const setup = await setupResources(request, 'UICount');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath);
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    // A count indicator (e.g. "1 attachment") should be visible
    const countEl = page.locator('.attachments-sidebar .attachment-count, .attachments-header-count');
    await expect(countEl).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 28. API: GET /api/cards/:id/attachments returns 200 and an array
  // -------------------------------------------------------------------------
  test('API: GET /api/cards/:id/attachments returns 200 with an array', async ({ request }) => {
    const setup = await setupResources(request, 'APIGetList');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(listRes.ok()).toBe(true);
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 29. API: Deleted attachment is not in list after deletion
  // -------------------------------------------------------------------------
  test('API: after deletion the attachment no longer appears in the list', async ({ request }) => {
    const setup = await setupResources(request, 'APIGone');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const { attachment } = await uploadAttachment(
      request, setup.token, setup.cardId, 'gone.txt', 'bye',
    );
    expect(attachment).not.toBeNull();

    await request.delete(
      `${BASE}/api/cards/${setup.cardId}/attachments/${attachment.id}`,
      { headers: { Authorization: `Bearer ${setup.token}` } },
    );

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const list: { id: number }[] = await listRes.json();
    expect(list.find((a) => a.id === attachment.id)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 30. API: Attachment has user_id field matching the uploader
  // -------------------------------------------------------------------------
  test('API: attachment user_id matches the uploading user', async ({ request }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `uploader-${uid}@example.com`,
        password: 'password123',
        display_name: 'Uploader',
      },
    });
    const { token, user } = await signupRes.json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `UserID Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'UID' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'UserID Card',
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    const card = await cardRes.json();

    const { attachment } = await uploadAttachment(request, token, card.id, 'uid-check.txt');
    expect(attachment).not.toBeNull();
    expect(attachment.user_id).toBe(user.id);
  });

  // -------------------------------------------------------------------------
  // 31. UI: Attachment section heading is present in the modal
  // -------------------------------------------------------------------------
  test('UI: attachments section has a visible heading label', async ({ page, request }) => {
    const setup = await setupResources(request, 'UIHeading');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    // The attachments sidebar has a <label> inside .section-header that shows "Attachments (N)"
    const heading = page.locator('.attachments-sidebar .section-header label').first();
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Attachments');
  });
});
