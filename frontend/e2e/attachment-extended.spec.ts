import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal 1×1 PNG buffer */
const PNG_DATA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

function makeTxtPath(name: string): string {
  const p = join(tmpdir(), name);
  writeFileSync(p, `Hello from ${name}`);
  return p;
}

function makePngPath(name: string): string {
  const p = join(tmpdir(), name);
  writeFileSync(p, PNG_DATA);
  return p;
}

// ---------------------------------------------------------------------------
// beforeEach shared setup
// ---------------------------------------------------------------------------

async function setupBoardAndOpenCard({
  page,
  request,
}: {
  page: import('@playwright/test').Page;
  request: import('@playwright/test').APIRequestContext;
}): Promise<void> {
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        display_name: 'Tester',
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Attach Board' },
    })
  ).json();

  // board.columns comes back directly in the create response
  const columns = board.columns;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    })
  ).json();

  await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Attach Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.locator('.card-item').click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
  await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Attachments Extended', () => {
  // -------------------------------------------------------------------------
  // 1. Upload multiple files (sequential — input only handles one at a time)
  // -------------------------------------------------------------------------
  test('upload two files sequentially and both appear in the list', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const file1 = makeTxtPath('ext-multi-a.txt');
    const file2 = makeTxtPath('ext-multi-b.txt');

    const fileInput = page.locator('.attachments-sidebar input[type="file"]');

    // Upload first file
    await fileInput.setInputFiles(file1);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(1, { timeout: 8000 });

    // Upload second file
    await fileInput.setInputFiles(file2);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(2, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 2. Attachment filename shown
  // -------------------------------------------------------------------------
  test('uploaded filename is visible in the attachment item', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const filePath = makeTxtPath('test-document.txt');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(filePath);

    await expect(page.locator('.attachment-name-small').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.attachment-name-small').first()).toContainText('test-document.txt');
  });

  // -------------------------------------------------------------------------
  // 3. Download attachment — the <a download> link carries the href
  // -------------------------------------------------------------------------
  test('download link has correct href for the uploaded file', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const filePath = makeTxtPath('download-test.txt');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(filePath);

    const link = page.locator('.attachment-name-small').first();
    await expect(link).toBeVisible({ timeout: 8000 });

    // The <a> element has href="/api/attachments/<id>" and download attribute
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/api\/attachments\/\d+/);

    const downloadAttr = await link.getAttribute('download');
    expect(downloadAttr).toBe('download-test.txt');
  });

  // -------------------------------------------------------------------------
  // 4. Attachment count shown in section header
  // -------------------------------------------------------------------------
  test('attachment count in section header updates after uploads', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const file1 = makeTxtPath('count-a.txt');
    const file2 = makeTxtPath('count-b.txt');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');

    // Initially 0
    await expect(page.locator('.attachments-sidebar label').first()).toContainText('Attachments (0)');

    await fileInput.setInputFiles(file1);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.attachments-sidebar label').first()).toContainText('Attachments (1)');

    await fileInput.setInputFiles(file2);
    await expect(page.locator('.attachment-item-sidebar')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.attachments-sidebar label').first()).toContainText('Attachments (2)');
  });

  // -------------------------------------------------------------------------
  // 5. Image attachment shows thumbnail <img>
  // -------------------------------------------------------------------------
  test('image attachment renders an img thumbnail', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const pngPath = makePngPath('test-image.png');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });
    // Image attachment renders an <img> with class attachment-thumb-small
    await expect(page.locator('.attachment-thumb-small')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 6. Non-image shows file icon (📎), not an img thumbnail
  // -------------------------------------------------------------------------
  test('non-image attachment shows file icon rather than img thumbnail', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const txtPath = makeTxtPath('icon-check.txt');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(txtPath);

    await expect(page.locator('.attachment-item-sidebar')).toBeVisible({ timeout: 8000 });

    // The icon span should be present
    await expect(page.locator('.attachment-icon-tiny')).toBeVisible({ timeout: 5000 });
    // No img thumbnail should exist for a text file
    await expect(page.locator('.attachment-thumb-small')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 7. Attachment persists across sessions (navigate away and back)
  // -------------------------------------------------------------------------
  test('attachment persists after navigating away and returning to the board', async ({ page, request }) => {
    await setupBoardAndOpenCard({ page, request });

    const filePath = makeTxtPath('persist-check.txt');
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(filePath);
    await expect(page.locator('.attachment-name-small').first()).toContainText('persist-check.txt', {
      timeout: 8000,
    });

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Navigate away to /boards list
    await page.goto('/boards');
    await page.waitForURL('**/boards');

    // Navigate back — use the board link
    await page.locator('a[href^="/boards/"]').first().click();

    // Wait for board to load (view-toggle appears), then switch to All Cards view
    await page.waitForSelector('.view-btn:has-text("All Cards")', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Reopen card
    await page.locator('.card-item').click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.waitForSelector('.attachments-sidebar', { timeout: 5000 });

    await expect(page.locator('.attachment-name-small').first()).toContainText('persist-check.txt', {
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 8. Large filename — displayed (truncated via CSS) without breaking layout
  // -------------------------------------------------------------------------
  test('attachment with very long filename is shown without breaking modal layout', async ({
    page,
    request,
  }) => {
    await setupBoardAndOpenCard({ page, request });

    // 55-char filename
    const longName = 'this-is-a-very-long-attachment-filename-that-exceeds-55-chars.txt';
    const longPath = makeTxtPath(longName);
    const fileInput = page.locator('.attachments-sidebar input[type="file"]');
    await fileInput.setInputFiles(longPath);

    const nameEl = page.locator('.attachment-name-small').first();
    await expect(nameEl).toBeVisible({ timeout: 8000 });
    await expect(nameEl).toContainText(longName);

    // Modal should still be on screen (not pushed off by overflow)
    const modal = page.locator('.card-detail-modal-unified');
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    // Modal has positive dimensions — layout is intact
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });
});
