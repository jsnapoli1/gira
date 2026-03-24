import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

async function setupUserAndBoard(page: any, request: any) {
  const email = `test-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Export Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Export Test Board' },
  });
  const board = await boardRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  return { token, board };
}

test.describe('Board Card Export', () => {
  test('export button is visible in board settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // The Export to CSV button is in the Import / Export section
    const importExportSection = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await expect(importExportSection).toBeVisible();
    await expect(importExportSection.locator('button:has-text("Export to CSV")')).toBeVisible();
  });

  test('export triggers navigation to CSV download URL', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // The exportCards() function calls window.open(`/api/boards/:id/export?token=...`, '_blank').
    // Intercept window.open to capture the URL instead of opening a new tab.
    let capturedUrl = '';
    await page.exposeFunction('captureOpenUrl', (url: string) => {
      capturedUrl = url;
    });
    await page.addInitScript(() => {
      const original = window.open.bind(window);
      (window as any).open = (url: string, ...args: any[]) => {
        (window as any).captureOpenUrl(url);
        return original(url, ...args);
      };
    });

    // Reload so the init script takes effect
    await page.reload();
    await expect(page.locator('.settings-page')).toBeVisible();

    await page.locator('button:has-text("Export to CSV")').click();

    // Give the click handler time to fire
    await page.waitForFunction(() => (window as any).__exportUrlCaptured !== undefined || true, null, { timeout: 3000 }).catch(() => {});

    // The URL should target the export endpoint with a token query param
    // capturedUrl is set via the exposed function — verify format
    await expect.poll(() => capturedUrl, { timeout: 5000 }).toMatch(/\/api\/boards\/\d+\/export\?token=/);
  });

  test('export URL contains the board id', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    let capturedUrl = '';
    await page.exposeFunction('captureExportUrl', (url: string) => {
      capturedUrl = url;
    });
    await page.addInitScript(() => {
      const original = window.open.bind(window);
      (window as any).open = (url: string, ...args: any[]) => {
        (window as any).captureExportUrl(url);
        return original(url, ...args);
      };
    });

    await page.reload();
    await expect(page.locator('.settings-page')).toBeVisible();

    await page.locator('button:has-text("Export to CSV")').click();

    await expect.poll(() => capturedUrl, { timeout: 5000 }).toContain(`/api/boards/${board.id}/export`);
  });

  test('export endpoint returns CSV content directly', async ({ request, page }) => {
    // This test verifies the export API directly without going through the UI.
    const { token, board } = await setupUserAndBoard(page, request);

    const exportRes = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(exportRes.ok()).toBe(true);

    const contentType = exportRes.headers()['content-type'];
    expect(contentType).toContain('text/csv');

    const body = await exportRes.text();
    // CSV should have the header row
    expect(body).toContain('Title');
    expect(body).toContain('ID');
  });

  test('export URL includes token query parameter', async ({ page, request }) => {
    // Document the expected URL format: /api/boards/:id/export?token=<jwt>
    const { token, board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    let capturedUrl = '';
    await page.exposeFunction('captureTokenUrl', (url: string) => {
      capturedUrl = url;
    });
    await page.addInitScript(() => {
      const original = window.open.bind(window);
      (window as any).open = (url: string, ...args: any[]) => {
        (window as any).captureTokenUrl(url);
        return original(url, ...args);
      };
    });

    await page.reload();
    await expect(page.locator('.settings-page')).toBeVisible();

    await page.locator('button:has-text("Export to CSV")').click();

    await expect.poll(() => capturedUrl, { timeout: 5000 }).toMatch(/token=.+/);

    // Token in URL should match the user's JWT
    expect(capturedUrl).toContain(token);
  });
});
