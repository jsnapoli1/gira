import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  prefix = 'cm',
): Promise<{ token: string; email: string; userId: number }> {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Credential Manager' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, email, userId: body.user?.id ?? 0 };
}

async function createGiteaCredential(
  request: any,
  token: string,
  opts: { displayName?: string; providerUrl?: string; apiToken?: string } = {},
) {
  const res = await request.post(`${BASE}/api/user/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      provider: 'gitea',
      provider_url: opts.providerUrl ?? 'https://gitea.example.com',
      api_token: opts.apiToken ?? 'test-api-token-abc',
      display_name: opts.displayName ?? 'Test Gitea',
    },
  });
  return res;
}

async function createGithubCredential(
  request: any,
  token: string,
  opts: { displayName?: string; apiToken?: string } = {},
) {
  const res = await request.post(`${BASE}/api/user/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      provider: 'github',
      api_token: opts.apiToken ?? 'ghp_test_token_xyz',
      display_name: opts.displayName ?? 'Test GitHub',
    },
  });
  return res;
}

// ---------------------------------------------------------------------------
// API Tests — credential CRUD
// ---------------------------------------------------------------------------

test.describe('Credential Management — API: Create', () => {
  test('POST /api/user/credentials with gitea provider returns 201 with id', async ({ request }) => {
    const { token } = await createUser(request, 'cm-create-gitea');
    const res = await createGiteaCredential(request, token);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.provider).toBe('gitea');
    expect(body.provider_url).toBe('https://gitea.example.com');
    expect(body.has_token).toBe(true);
  });

  test('POST /api/user/credentials with github provider returns 201 with id', async ({ request }) => {
    const { token } = await createUser(request, 'cm-create-github');
    const res = await createGithubCredential(request, token);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.provider).toBe('github');
    expect(body.has_token).toBe(true);
  });

  test('POST with label (display_name) stores and returns it', async ({ request }) => {
    const { token } = await createUser(request, 'cm-label');
    const res = await createGiteaCredential(request, token, { displayName: 'My Labelled Cred' });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.display_name).toBe('My Labelled Cred');
  });

  test('POST response never contains raw api_token field', async ({ request }) => {
    const { token } = await createUser(request, 'cm-no-token');
    const res = await createGiteaCredential(request, token, { apiToken: 'super-secret-key-123' });
    expect(res.status()).toBe(201);
    const raw = await res.text();
    // Token must not appear in the serialized response
    expect(raw).not.toContain('super-secret-key-123');
    const body = JSON.parse(raw);
    expect(body.api_token).toBeUndefined();
    // But has_token must confirm the token is stored
    expect(body.has_token).toBe(true);
  });

  test('POST without api_token returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'cm-no-apitoken');
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST without provider returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'cm-no-provider');
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'some-token' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST with unknown provider returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'cm-bad-provider');
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'bitbucket', api_token: 'bb_token' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Credential Management — API: List', () => {
  test('GET /api/user/credentials returns an array', async ({ request }) => {
    const { token } = await createUser(request, 'cm-list-empty');
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/user/credentials list contains the created credential', async ({ request }) => {
    const { token } = await createUser(request, 'cm-list-contains');
    const createRes = await createGiteaCredential(request, token, { displayName: 'Listed Cred' });
    const created = await createRes.json();

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const list: any[] = await listRes.json();
    const found = list.find((c) => c.id === created.id);
    expect(found).toBeTruthy();
    expect(found.display_name).toBe('Listed Cred');
  });

  test('credential in list has provider_url and display_name but NOT api_token', async ({ request }) => {
    const { token } = await createUser(request, 'cm-list-noleak');
    await createGiteaCredential(request, token, {
      displayName: 'NoLeak Cred',
      providerUrl: 'https://gitea-noleak.example.com',
      apiToken: 'super-secret-never-list',
    });

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await listRes.text();
    expect(raw).not.toContain('super-secret-never-list');

    const list: any[] = JSON.parse(raw);
    const item = list.find((c) => c.display_name === 'NoLeak Cred');
    expect(item).toBeTruthy();
    expect(item.provider_url).toBe('https://gitea-noleak.example.com');
    expect(item.display_name).toBe('NoLeak Cred');
    expect(item.api_token).toBeUndefined();
  });

  test('multiple credentials can exist for the same user', async ({ request }) => {
    const { token } = await createUser(request, 'cm-multi');
    await createGiteaCredential(request, token, { displayName: 'Multi Gitea 1' });
    await createGiteaCredential(request, token, {
      displayName: 'Multi Gitea 2',
      providerUrl: 'https://gitea2.example.com',
    });
    await createGithubCredential(request, token, { displayName: 'Multi GitHub' });

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list: any[] = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(3);
    const names = list.map((c) => c.display_name);
    expect(names).toContain('Multi Gitea 1');
    expect(names).toContain('Multi Gitea 2');
    expect(names).toContain('Multi GitHub');
  });
});

test.describe('Credential Management — API: Get single', () => {
  test('GET /api/user/credentials/:id returns 200 for owned credential', async ({ request }) => {
    const { token } = await createUser(request, 'cm-get');
    const createRes = await createGiteaCredential(request, token, { displayName: 'Get Me' });
    const created = await createRes.json();

    const getRes = await request.get(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.id).toBe(created.id);
    expect(body.display_name).toBe('Get Me');
    expect(body.api_token).toBeUndefined();
    expect(body.has_token).toBe(true);
  });

  test('GET another user\'s credential by ID returns 404 (no info leak)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'cm-idor-owner');
    const { token: attackerToken } = await createUser(request, 'cm-idor-attacker');

    const createRes = await createGiteaCredential(request, ownerToken, {
      displayName: 'Owner Only',
      apiToken: 'ghp_idor_victim_cred',
    });
    const created = await createRes.json();

    const attackRes = await request.get(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
    });
    // Must return 404, not 200 or 403 that could leak existence
    expect(attackRes.status()).toBe(404);
  });
});

test.describe('Credential Management — API: Update', () => {
  test('PUT /api/user/credentials/:id updates the display_name', async ({ request }) => {
    const { token } = await createUser(request, 'cm-update-name');
    const createRes = await createGiteaCredential(request, token, { displayName: 'Original Name' });
    const created = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'updated-token-xyz', display_name: 'Updated Name' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.display_name).toBe('Updated Name');
  });

  test('PUT update response does not echo back the raw api_token', async ({ request }) => {
    const { token } = await createUser(request, 'cm-update-noleak');
    const createRes = await createGiteaCredential(request, token, { displayName: 'Echo Test' });
    const created = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'secret-never-echo-back', display_name: 'Echo Test Updated' },
    });
    expect(updateRes.status()).toBe(200);
    const raw = await updateRes.text();
    expect(raw).not.toContain('secret-never-echo-back');
    const body = JSON.parse(raw);
    expect(body.api_token).toBeUndefined();
    expect(body.has_token).toBe(true);
  });

  test('PUT another user\'s credential returns 404', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'cm-update-idor-owner');
    const { token: attackerToken } = await createUser(request, 'cm-update-idor-attacker');

    const createRes = await createGiteaCredential(request, ownerToken, { displayName: 'Cannot Hijack' });
    const created = await createRes.json();

    const attackRes = await request.put(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
      data: { api_token: 'hijack-token', display_name: 'HIJACKED' },
    });
    expect(attackRes.status()).toBe(404);

    // Original name must be unchanged
    const getRes = await request.get(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const original = await getRes.json();
    expect(original.display_name).toBe('Cannot Hijack');
  });
});

test.describe('Credential Management — API: Delete', () => {
  test('DELETE /api/user/credentials/:id removes the credential (204)', async ({ request }) => {
    const { token } = await createUser(request, 'cm-delete');
    const createRes = await createGiteaCredential(request, token, { displayName: 'Delete Me API' });
    const created = await createRes.json();

    const delRes = await request.delete(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    // Verify it is gone from the list
    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list: any[] = await listRes.json();
    expect(list.find((c) => c.id === created.id)).toBeUndefined();
  });

  test('DELETE another user\'s credential returns 403 or 404', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'cm-del-idor-owner');
    const { token: attackerToken } = await createUser(request, 'cm-del-idor-attacker');

    const createRes = await createGiteaCredential(request, ownerToken, { displayName: 'Cannot Delete' });
    const created = await createRes.json();

    const attackRes = await request.delete(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
    });
    expect([403, 404]).toContain(attackRes.status());

    // Credential must still exist for the owner
    const getRes = await request.get(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(getRes.status()).toBe(200);
  });
});

test.describe('Credential Management — API: Test connection', () => {
  test('POST /api/user/credentials/test with invalid gitea key returns JSON with success field', async ({ request }) => {
    const { token } = await createUser(request, 'cm-test-invalid');
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'http://127.0.0.1:1',  // nothing listening
        api_token: 'bad-token',
      },
    });
    // 200 with { success: false } or a 4xx for network error
    expect([200, 400, 422, 503]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.message).toBe('string');
    }
  });

  test('POST /api/user/credentials/test with missing provider returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'cm-test-no-provider');
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'some-token' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials/test with gitea but missing provider_url returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'cm-test-no-url');
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', api_token: 'test-token' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Credential Management — API: Authorization', () => {
  test('GET /api/user/credentials without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/user/credentials`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/user/credentials without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/user/credentials`, {
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com', api_token: 'tok' },
    });
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/user/credentials/:id without auth returns 401', async ({ request }) => {
    const res = await request.delete(`${BASE}/api/user/credentials/1`);
    expect(res.status()).toBe(401);
  });

  test('PUT /api/user/credentials/:id without auth returns 401', async ({ request }) => {
    const res = await request.put(`${BASE}/api/user/credentials/1`, {
      data: { display_name: 'x', api_token: 'y' },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// UI Tests — /settings page, credentials section
// ---------------------------------------------------------------------------

test.describe('Credential Management — UI: Settings page structure', () => {
  test('credentials section visible in /settings page (Your API Credentials heading)', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-visible');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Your API Credentials")'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('credentials section shows empty state when no credentials exist', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-empty');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet', {
      timeout: 10000,
    });
  });

  test('Add Credential button is present on the settings page', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-addbtn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('button:has-text("Add Credential")')).toBeVisible({ timeout: 10000 });
  });

  test('add credential form has URL field and API key (token) field', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-formfields');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    // URL field for Gitea (default tab)
    await expect(page.locator('#providerUrl')).toBeVisible();
    // Token field (password type)
    await expect(page.locator('#apiToken')).toBeVisible();
  });

  test('credential API key field is masked (type="password")', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-masked');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#apiToken')).toHaveAttribute('type', 'password');
  });
});

test.describe('Credential Management — UI: Save credential', () => {
  test('can save a GitHub credential via settings UI and it appears in the list', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-save');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    // Switch to GitHub tab (no URL needed)
    await page.click('.provider-tab:has-text("GitHub")');
    await page.fill('#apiToken', 'ghp_fake_ui_save_test');
    await page.fill('#displayName', 'UI Save Test GitHub');
    await page.click('button[type="submit"]:has-text("Save")');

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.credential-name:has-text("UI Save Test GitHub")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('saved credential appears in list after page reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-reload');
    // Create credential via API so we skip the modal interaction
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_persist_test',
        display_name: 'Persist Reload Cred',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(
      page.locator('.credential-name:has-text("Persist Reload Cred")'),
    ).toBeVisible({ timeout: 8000 });

    await page.reload();

    await expect(
      page.locator('.credential-name:has-text("Persist Reload Cred")'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('credential label (display_name) shown in credentials list', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-label');
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'tok-label',
        display_name: 'My Custom Label',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.credential-name:has-text("My Custom Label")')).toBeVisible({
      timeout: 8000,
    });
  });

  test('Gitea credential shows provider label "Gitea" in list', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-provider-label');
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'tok-provider-label',
        display_name: 'Gitea Provider Label',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.credential-provider')).toContainText('Gitea', { timeout: 8000 });
  });
});

test.describe('Credential Management — UI: Delete credential', () => {
  test('can delete credential via UI delete button', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-delete');
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_ui_delete_me',
        display_name: 'UI Delete Me',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.credential-name:has-text("UI Delete Me")')).toBeVisible({
      timeout: 8000,
    });

    page.once('dialog', (d) => d.accept());
    await page.click('.credential-item button[title="Delete credential"]');

    await expect(
      page.locator('.credential-name:has-text("UI Delete Me")'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('after deleting last credential, empty state is shown again', async ({ page, request }) => {
    const { token } = await createUser(request, 'cm-ui-delete-empty');
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_last_one',
        display_name: 'Last Cred',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.credential-item')).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await page.click('.credential-item button[title="Delete credential"]');

    await expect(page.locator('.empty-state')).toContainText(
      'No API credentials configured yet',
      { timeout: 5000 },
    );
  });
});

test.describe('Credential Management — UI: Test connection', () => {
  test('Test Connection button is visible next to credential modal form', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-testbtn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('button:has-text("Test Connection")')).toBeVisible();
  });

  test('test connection shows success feedback when mocked response is success', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-test-success');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connection successful' }),
      });
    });

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'valid-token-test');
    await page.click('button:has-text("Test Connection")');

    await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 5000 });
  });

  test('test connection shows failure feedback when mocked response is failure', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'cm-ui-test-fail');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Connection failed: unauthorized' }),
      });
    });

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'invalid-token');
    await page.click('button:has-text("Test Connection")');

    await expect(page.locator('.status-badge.error')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Credential Management — UI: Edit credential (fixme — no edit UI yet)', () => {
  test.fixme(
    'edit credential modal opens when edit button is clicked',
    async ({ page, request }) => {
      // PUT /api/user/credentials/:id exists in the backend, but Settings.tsx
      // does not currently render an edit button on credential items.
      // When an edit UI is added, this test should:
      //   1. Create a credential via API
      //   2. Navigate to /settings
      //   3. Click the edit button on the credential item
      //   4. Change the display_name in the modal
      //   5. Save and verify the updated name appears in the list
      const { token } = await createUser(request, 'cm-edit-fixme');
      await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { provider: 'github', api_token: 'ghp_edit', display_name: 'Edit Me Cred' },
      });
      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto('/settings');
      const credItem = page.locator('.credential-item').filter({ hasText: 'Edit Me Cred' });
      await credItem.locator('.btn-edit, button:has-text("Edit")').click();
      await page.fill('#displayName', 'Renamed Cred');
      await page.click('button[type="submit"]:has-text("Save")');
      await expect(page.locator('.credential-name:has-text("Renamed Cred")')).toBeVisible({
        timeout: 5000,
      });
    },
  );

  test.fixme(
    'swimlane_id can be set on a credential to link it to a swimlane',
    async ({ request }) => {
      // The swimlane_credentials table exists in the DB schema, but the
      // /api/user/credentials POST endpoint does not accept a swimlane_id field.
      // When per-swimlane credential linking is exposed, add an API test here that:
      //   1. Creates a board with a swimlane
      //   2. Creates a credential with swimlane_id set
      //   3. Verifies the credential is returned and linked
    },
  );
});
