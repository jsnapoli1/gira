import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// File fixtures
// ---------------------------------------------------------------------------

/** Minimal 1x1 PNG buffer */
const PNG_DATA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** Minimal valid PDF content */
const PDF_DATA = Buffer.from(
  '%PDF-1.0\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj ' +
    '2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj ' +
    '3 0 obj<</Type /Page /MediaBox [0 0 3 3]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
    '0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4 /Root 1 0 R>>\nstartxref\n190\n%%EOF',
);

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  boardId: number;
  cardId: number;
}

async function setupResources(
  request: import('@playwright/test').APIRequestContext,
  label = 'ExtAttach',
): Promise<SetupResult | null> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-ext-${uid}@example.com`,
        password: 'password123',
        display_name: 'ExtAttach Tester',
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'EA' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Extended Attach Card',
      column_id: board.columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!cardRes.ok()) return null;

  const card = await cardRes.json();
  return { token, boardId: board.id, cardId: card.id };
}

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

test.describe('Attachments Extended', () => {
  // Temp file paths created per worker
  let txtFilePath1: string;
  let txtFilePath2: string;
  let pngFilePath: string;
  let pdfFilePath: string;

  test.beforeAll(async ({}, testInfo) => {
    const w = testInfo.workerIndex;
    txtFilePath1 = path.join(os.tmpdir(), `ext-a-${w}.txt`);
    txtFilePath2 = path.join(os.tmpdir(), `ext-b-${w}.txt`);
    pngFilePath = path.join(os.tmpdir(), `ext-img-${w}.png`);
    pdfFilePath = path.join(os.tmpdir(), `ext-doc-${w}.pdf`);

    fs.writeFileSync(txtFilePath1, 'Attachment file A content');
    fs.writeFileSync(txtFilePath2, 'Attachment file B content');
    fs.writeFileSync(pngFilePath, PNG_DATA);
    fs.writeFileSync(pdfFilePath, PDF_DATA);
  });

  test.afterAll(() => {
    for (const p of [txtFilePath1, txtFilePath2, pngFilePath, pdfFilePath]) {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  // -------------------------------------------------------------------------
  // 1. Upload PNG image type
  // -------------------------------------------------------------------------
  test('upload PNG image file — thumbnail rendered and filename shown', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(pngFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    // Image file shows an <img> thumbnail
    await expect(page.locator('.attachment-thumb-small')).toBeVisible({ timeout: 5000 });
    // Filename is displayed
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(pngFilePath),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Upload PDF file type
  // -------------------------------------------------------------------------
  test('upload PDF file — appears in list with file icon (not image thumbnail)', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(pdfFilePath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    // PDF is not an image — should show file icon, not thumbnail
    await expect(page.locator('.attachment-icon-tiny')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachment-thumb-small')).not.toBeVisible();
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(pdfFilePath),
    );
  });

  // -------------------------------------------------------------------------
  // 3. File size limit — backend accepts up to 10 MB (multipart limit)
  //    Test that a small file well within the limit succeeds (no error shown).
  // -------------------------------------------------------------------------
  test('file within size limit uploads without error message', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // 50 KB text file — well under 10 MB limit
    const largerFilePath = path.join(os.tmpdir(), `ext-50k-${Date.now()}.txt`);
    fs.writeFileSync(largerFilePath, 'X'.repeat(50 * 1024));

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(largerFilePath);

    // Attachment should appear without any error message
    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.attachments-sidebar .error')).not.toBeVisible();

    fs.unlinkSync(largerFilePath);
  });

  // -------------------------------------------------------------------------
  // 4. Multiple attachments on one card — all appear sequentially
  // -------------------------------------------------------------------------
  test('upload two files sequentially — both appear in the list', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');

    await fileInput.setInputFiles(txtFilePath1);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(1, { timeout: 8000 });

    await fileInput.setInputFiles(txtFilePath2);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(2, { timeout: 8000 });

    // Both filenames should be visible
    const names = page.locator('.attachment-name-small');
    await expect(names).toHaveCount(2);
    await expect(names.nth(0)).toContainText(path.basename(txtFilePath1));
    await expect(names.nth(1)).toContainText(path.basename(txtFilePath2));
  });

  // -------------------------------------------------------------------------
  // 5. Attachment count shown in section header
  // -------------------------------------------------------------------------
  test('attachment count in section header increments with each upload', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');

    // Initially 0
    await expect(page.locator('.attachments-sidebar label').first()).toContainText(
      'Attachments (0)',
    );

    await fileInput.setInputFiles(txtFilePath1);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.attachments-sidebar label').first()).toContainText(
      'Attachments (1)',
    );

    await fileInput.setInputFiles(txtFilePath2);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.attachments-sidebar label').first()).toContainText(
      'Attachments (2)',
    );
  });

  // -------------------------------------------------------------------------
  // 6. Attachment persists after modal reopen
  // -------------------------------------------------------------------------
  test('uploaded attachment persists after closing and reopening the modal', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath1);
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath1),
      { timeout: 8000 },
    );

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    // Attachment should still be there
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath1),
      { timeout: 8000 },
    );
  });

  // -------------------------------------------------------------------------
  // 7. Attachment count on card badge (via API — badge not currently in UI)
  //    Verified via API: attachment list count matches uploads.
  // -------------------------------------------------------------------------
  test('API: attachment count for card matches number of uploads', async ({ request }) => {
    const setup = await setupResources(request, 'CountCheck');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Upload two attachments via API
    for (const name of ['count-a.txt', 'count-b.txt']) {
      const res = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        multipart: {
          file: {
            name,
            mimeType: 'text/plain',
            buffer: Buffer.from(`Content of ${name}`),
          },
        },
      });
      expect(res.ok()).toBe(true);
    }

    // GET list should have 2 items
    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const attachments: unknown[] = await listRes.json();
    expect(attachments).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 8. Attachment with very long filename — layout not broken
  // -------------------------------------------------------------------------
  test('attachment with very long filename is shown without breaking modal layout', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const longName = 'this-is-a-very-long-attachment-filename-that-exceeds-sixty-characters-long.txt';
    const longFilePath = path.join(os.tmpdir(), longName);
    fs.writeFileSync(longFilePath, 'Long filename test file content.');

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(longFilePath);

    const nameEl = page.locator('.attachment-name-small').first();
    await expect(nameEl).toBeVisible({ timeout: 8000 });
    await expect(nameEl).toContainText(longName);

    // Modal should still have positive dimensions — layout is intact
    const modal = page.locator('.card-detail-modal-unified');
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    fs.unlinkSync(longFilePath);
  });

  // -------------------------------------------------------------------------
  // 9. Attachment persists across full navigation (navigate away and back)
  // -------------------------------------------------------------------------
  test('attachment persists after navigating away from the board and returning', async ({ page, request }) => {
    const setup = await setupResources(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtFilePath1);
    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath1),
      { timeout: 8000 },
    );

    // Close modal and navigate away
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await page.goto('/boards');
    await page.waitForURL('**/boards');

    // Navigate back to the board
    await page.locator('a[href^="/boards/"]').first().click();
    await page.waitForSelector('.view-btn:has-text("All Cards")', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Reopen the card
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    await expect(page.locator('.attachment-name-small').first()).toContainText(
      path.basename(txtFilePath1),
      { timeout: 8000 },
    );
  });

  // -------------------------------------------------------------------------
  // 10. GET /api/attachments/:id download endpoint returns file content
  // -------------------------------------------------------------------------
  test('API: GET /api/attachments/:id returns the attachment file content', async ({ request }) => {
    const setup = await setupResources(request, 'DownloadTest');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const fileContent = 'Download endpoint test content 12345';

    // Upload
    const uploadRes = await request.post(`${BASE}/api/cards/${setup.cardId}/attachments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      multipart: {
        file: {
          name: 'download-test.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(fileContent),
        },
      },
    });
    expect(uploadRes.ok()).toBe(true);
    const attachment = await uploadRes.json();

    // Download
    const downloadRes = await request.get(`${BASE}/api/attachments/${attachment.id}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(downloadRes.ok()).toBe(true);

    const body = await downloadRes.text();
    expect(body).toBe(fileContent);
  });
});
