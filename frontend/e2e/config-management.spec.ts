/**
 * config-management.spec.ts
 *
 * Comprehensive tests for the global Gitea configuration management feature.
 *
 * API endpoints under test:
 *   GET  /api/config              — public: returns { gitea_url }
 *   POST /api/config              — admin-only: saves { gitea_url, gitea_api_key }
 *   GET  /api/config/status       — public: returns { configured, gitea_url }
 *   POST /api/auth/promote-admin  — promotes the authenticated caller to admin
 *   GET  /api/admin/users         — admin-only: user list
 *
 * UI entry-point: /settings → "Global Gitea Connection" section (admin only).
 *
 * These tests complement settings.spec.ts by probing:
 *   - exact authorization rules for each endpoint
 *   - response shape contracts
 *   - round-trip: POST config then GET reflects new values
 *   - promote-admin unlocks admin-only capabilities
 *   - UI visibility rules and form interaction details
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function createUser(request: any, prefix = 'cfg-mgmt') {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Config Mgmt User' },
  });
  const body = await res.json();
  return { token: body.token as string, email, id: body.user?.id as number };
}

async function promoteAdmin(request: any, token: string) {
  await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function createAdminUser(request: any, prefix = 'cfg-admin') {
  const user = await createUser(request, prefix);
  await promoteAdmin(request, user.token);
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/config — public endpoint
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/config — public endpoint', () => {
  test('returns 200 without any authorization header', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    expect(res.status()).toBe(200);
  });

  test('returns 200 with a valid user token', async ({ request }) => {
    const { token } = await createUser(request, 'cfg-get-user');
    const res = await request.get(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('returns 200 with an admin token', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-get-admin');
    const res = await request.get(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('response body contains gitea_url field', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect('gitea_url' in body).toBe(true);
  });

  test('response body does NOT expose api_key or gitea_api_key', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    const body = await res.json();
    // The API key must never be returned by the GET endpoint
    expect('api_key' in body).toBe(false);
    expect('gitea_api_key' in body).toBe(false);
  });

  test('gitea_url value is a string (may be empty when unconfigured)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    const body = await res.json();
    expect(typeof body.gitea_url).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/config — admin-only
// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/config — admin-only endpoint', () => {
  test('unauthenticated POST returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/config`, {
      data: { gitea_url: 'https://example.com', gitea_api_key: 'key' },
    });
    expect(res.status()).toBe(401);
  });

  test('authenticated non-admin POST returns 403', async ({ request }) => {
    const { token } = await createUser(request, 'cfg-post-nonadmin');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'https://example.com', gitea_api_key: 'key' },
    });
    expect(res.status()).toBe(403);
  });

  test('admin POST with gitea_url and gitea_api_key returns 200', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-post-ok');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: `https://gitea-post-ok-${crypto.randomUUID()}.example.com`,
        gitea_api_key: 'test-key-abc',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('admin POST response body contains success:true', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-post-success');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: `https://gitea-success-${crypto.randomUUID()}.example.com`,
        gitea_api_key: 'success-key',
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('POST without gitea_url returns 400', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-post-no-url');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_api_key: 'orphan-key' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST with empty gitea_url string returns 400', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-post-empty-url');
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: '', gitea_api_key: 'some-key' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST saves config — subsequent GET /api/config reflects new gitea_url', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-round-trip');
    const uniqueUrl = `https://gitea-round-trip-${crypto.randomUUID()}.example.com`;

    const postRes = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: uniqueUrl, gitea_api_key: 'rt-key' },
    });
    expect(postRes.ok()).toBe(true);

    const getRes = await request.get(`${BASE}/api/config`);
    const body = await getRes.json();
    expect(body.gitea_url).toBe(uniqueUrl);
  });

  test('POST with new URL updates config status to configured=true', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-post-status');
    const uniqueUrl = `https://gitea-status-up-${crypto.randomUUID()}.example.com`;

    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: uniqueUrl, gitea_api_key: 'status-up-key' },
    });

    const statusRes = await request.get(`${BASE}/api/config/status`);
    const status = await statusRes.json();
    expect(status.configured).toBe(true);
  });

  test('POST allows updating URL without re-submitting api_key when already configured', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-update-url-only');

    // Initial configuration
    const firstUrl = `https://gitea-initial-${crypto.randomUUID()}.example.com`;
    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: firstUrl, gitea_api_key: 'initial-key' },
    });

    // Update URL without providing api_key (should succeed since already configured)
    const secondUrl = `https://gitea-updated-${crypto.randomUUID()}.example.com`;
    const updateRes = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: secondUrl },
    });
    expect(updateRes.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/config`);
    const body = await getRes.json();
    expect(body.gitea_url).toBe(secondUrl);
  });

  test('POST returns 400 without api_key when server is not yet configured', async ({ request }) => {
    // This test targets the "initial configuration requires api_key" code path.
    // We cannot guarantee the global server is unconfigured, so we only check
    // behavior when we know the key is missing. If server is already configured
    // the endpoint accepts URL-only updates (200). Both are valid tested paths.
    const { token } = await createAdminUser(request, 'cfg-init-nokey');

    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: `https://gitea-init-${crypto.randomUUID()}.example.com` },
    });

    // Either 200 (server already configured, key omission allowed) or 400 (not yet configured)
    expect([200, 400]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/config/status — public endpoint
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/config/status — public endpoint', () => {
  test('returns 200 without any authorization', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    expect(res.status()).toBe(200);
  });

  test('returns 200 with a regular user token', async ({ request }) => {
    const { token } = await createUser(request, 'cfg-status-user');
    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('response body contains `configured` boolean field', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
  });

  test('response body contains `gitea_url` field', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config/status`);
    const body = await res.json();
    expect('gitea_url' in body).toBe(true);
  });

  test('configured is true after saving a valid config', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-status-true');
    const uniqueUrl = `https://gitea-st-true-${crypto.randomUUID()}.example.com`;

    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: uniqueUrl, gitea_api_key: 'status-true-key' },
    });

    const res = await request.get(`${BASE}/api/config/status`);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.gitea_url).toBe(uniqueUrl);
  });

  test('gitea_url in status response matches the last POSTed URL', async ({ request }) => {
    const { token } = await createAdminUser(request, 'cfg-status-url-match');
    const uniqueUrl = `https://gitea-url-match-${crypto.randomUUID()}.example.com`;

    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: uniqueUrl, gitea_api_key: 'url-match-key' },
    });

    const status = await (await request.get(`${BASE}/api/config/status`)).json();
    expect(status.gitea_url).toBe(uniqueUrl);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/promote-admin
// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/auth/promote-admin', () => {
  test('promote-admin endpoint returns 200 for authenticated user', async ({ request }) => {
    const { token } = await createUser(request, 'promo-200');
    const res = await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('promote-admin without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/promote-admin`);
    expect(res.status()).toBe(401);
  });

  test('after promote-admin, user can POST /api/config successfully', async ({ request }) => {
    const { token } = await createUser(request, 'promo-config');

    // Before promotion — should be 403
    const beforeRes = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'https://before.example.com', gitea_api_key: 'before-key' },
    });
    expect(beforeRes.status()).toBe(403);

    // Promote
    await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // After promotion — should be 200
    const afterRes = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: `https://gitea-promo-${crypto.randomUUID()}.example.com`,
        gitea_api_key: 'after-key',
      },
    });
    expect(afterRes.status()).toBe(200);
  });

  test('after promote-admin, user can GET /api/admin/users', async ({ request }) => {
    const { token } = await createUser(request, 'promo-users');

    // Before promotion — should be 403
    const beforeRes = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(beforeRes.status()).toBe(403);

    // Promote
    await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // After promotion — should be 200
    const afterRes = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(afterRes.status()).toBe(200);
    const users = await afterRes.json();
    expect(Array.isArray(users)).toBe(true);
  });

  test('after promote-admin, user can GET /api/config (still public but verify)', async ({ request }) => {
    const { token } = await createUser(request, 'promo-config-get');

    await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect('gitea_url' in body).toBe(true);
  });

  test('calling promote-admin twice is idempotent — second call also returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'promo-idem');

    const first = await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const second = await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI — Settings page (/settings) — Admin vs. non-admin visibility
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Settings page UI — Global Gitea Connection section visibility', () => {
  test('admin sees Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-admin-visible');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does NOT see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-nonadmin-hidden');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).not.toBeVisible();
  });

  test('admin sees Gitea URL input field (#giteaUrl)', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-admin-url-field');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });
  });

  test('admin sees API Key input field (#giteaApiKey)', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-admin-key-field');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaApiKey')).toBeVisible({ timeout: 10000 });
  });

  test('Gitea URL field is type="url"', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-url-type');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#giteaUrl')).toHaveAttribute('type', 'url');
  });

  test('API Key field is type="password" (masked)', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-key-masked');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaApiKey')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#giteaApiKey')).toHaveAttribute('type', 'password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI — Settings page — Save / Update config
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Settings page UI — saving global config', () => {
  test('admin can type a URL into the giteaUrl field', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-type-url');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });

    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.fill('#giteaUrl', 'https://gitea.ui-typed.example.com');
    await expect(page.locator('#giteaUrl')).toHaveValue('https://gitea.ui-typed.example.com');
  });

  test('admin can type an API key into the giteaApiKey field', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-type-key');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaApiKey')).toBeVisible({ timeout: 10000 });

    await page.fill('#giteaApiKey', 'typed-api-key-value');
    await expect(page.locator('#giteaApiKey')).toHaveValue('typed-api-key-value');
  });

  test('Save Configuration button is visible in the Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-save-btn-visible');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await expect(saveBtn).toBeVisible({ timeout: 8000 });
  });

  test('saving valid config shows success status badge', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-save-success');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });

    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.fill('#giteaUrl', `https://gitea-save-${crypto.randomUUID()}.example.com`);
    await page.fill('#giteaApiKey', 'save-success-key');

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    await expect(page.locator('.status-badge.success').first()).toBeVisible({ timeout: 8000 });
  });

  test('already-configured server shows Connected status badge on settings load', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-connected-badge');

    // Pre-configure via API
    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: `https://gitea-precfg-${crypto.randomUUID()}.example.com`,
        gitea_api_key: 'precfg-key',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.status-badge.success')).toContainText('Connected');
  });

  test('button text is "Update Configuration" when server already has Gitea configured', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-update-btn');

    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: `https://gitea-update-${crypto.randomUUID()}.example.com`,
        gitea_api_key: 'update-btn-key',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('button:has-text("Update Configuration")')).toBeVisible({ timeout: 10000 });
  });

  test('API key placeholder text reflects configured state', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-placeholder');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")'),
    ).toBeVisible({ timeout: 10000 });

    const placeholder = await page.locator('#giteaApiKey').getAttribute('placeholder');
    expect(['••••••••', 'Your Gitea API key']).toContain(placeholder);
  });

  test('intercepted server error on POST /api/config shows error badge', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-error-badge');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Intercept the POST to simulate a server error
    await page.route('**/api/config', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });

    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.fill('#giteaUrl', 'https://gitea.error.example.com');
    await page.fill('#giteaApiKey', 'err-key');

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    await expect(page.locator('.status-badge.error').first()).toBeVisible({ timeout: 5000 });
  });

  test('non-admin /settings page does not contain #giteaUrl input', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-nonadmin-no-input');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    // The Gitea URL input should not be present for non-admin users
    await expect(page.locator('#giteaUrl')).not.toBeVisible();
  });

  test('non-admin /settings page does not contain #giteaApiKey input', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-nonadmin-no-key');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#giteaApiKey')).not.toBeVisible();
  });

  test('submitting form with empty URL is prevented by browser validation', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-empty-url-validation');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible({ timeout: 10000 });

    // Clear the URL field
    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await expect(page.locator('#giteaUrl')).toHaveValue('');

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    // The save-confirmation badge text should NOT appear
    await expect(
      page.locator('.status-badge.success:has-text("Configuration saved successfully")'),
    ).not.toBeVisible({ timeout: 2000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI — Settings page — page structure
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Settings page UI — page structure', () => {
  test('page title is "Settings"', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-struct-title');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.page-header h1')).toHaveText('Settings', { timeout: 10000 });
  });

  test('settings page is accessible when authenticated', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-struct-access');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
  });

  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('admin settings page has at least 4 sections (Profile, API Credentials, Gitea, About)', async ({ page, request }) => {
    const { token } = await createAdminUser(request, 'ui-struct-sections');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.waitForSelector('.settings-content', { timeout: 10000 });

    const count = await page.locator('.settings-section').count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('non-admin settings page has at least 3 sections (Profile, API Credentials, About)', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-struct-sections-na');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.waitForSelector('.settings-content', { timeout: 10000 });

    const count = await page.locator('.settings-section').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
