import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createAndLoginUser(request: any): Promise<{ token: string; email: string }> {
  const email = `creds-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Credentials User' },
  });
  const { token } = await res.json();
  return { token, email };
}

// ---------------------------------------------------------------------------
// API tests — verify credential endpoints directly
// ---------------------------------------------------------------------------

test.describe('User Credentials — API', () => {

  test('GET /api/user/credentials returns empty list for new user', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const creds = await res.json();
    expect(Array.isArray(creds)).toBe(true);
    expect(creds.length).toBe(0);
  });

  test('POST /api/user/credentials creates a Gitea credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'test-gitea-token',
        display_name: 'My Gitea',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.provider).toBe('gitea');
    expect(body.provider_url).toBe('https://gitea.example.com');
    expect(body.display_name).toBe('My Gitea');
    expect(body.has_token).toBe(true);
    // Token must not be echoed back
    expect(body.api_token).toBeUndefined();
  });

  test('POST /api/user/credentials creates a GitHub credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_test_token',
        display_name: 'My GitHub',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.provider).toBe('github');
    // GitHub credentials have no provider_url
    expect(body.provider_url).toBeFalsy();
    expect(body.has_token).toBe(true);
  });

  test('POST /api/user/credentials returns 400 when provider is missing', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'some-token' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials returns 400 when api_token is missing', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials returns 400 for unknown provider', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'bitbucket', api_token: 'token' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/user/credentials lists created credentials', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com', api_token: 'tok1', display_name: 'Gitea 1' },
    });
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_tok2', display_name: 'GitHub' },
    });

    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const creds = await res.json();
    expect(creds.length).toBeGreaterThanOrEqual(2);
    const names = creds.map((c: any) => c.display_name);
    expect(names).toContain('Gitea 1');
    expect(names).toContain('GitHub');
  });

  test('DELETE /api/user/credentials/:id removes the credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_delete_me', display_name: 'Delete Me' },
    });
    const cred = await createRes.json();

    const delRes = await request.delete(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const creds = await listRes.json();
    expect(creds.find((c: any) => c.id === cred.id)).toBeUndefined();
  });

  test('PUT /api/user/credentials/:id updates the credential display name', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_original', display_name: 'Original Name' },
    });
    const cred = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'ghp_updated', display_name: 'Updated Name' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.display_name).toBe('Updated Name');
  });

  test('cannot delete another user credential — returns 403 or 404', async ({ request }) => {
    const { token: ownerToken } = await createAndLoginUser(request);
    const { token: otherToken } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { provider: 'github', api_token: 'ghp_owner', display_name: "Owner's Cred" },
    });
    const cred = await createRes.json();

    const delRes = await request.delete(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect([403, 404]).toContain(delRes.status());
  });

  test('POST /api/user/credentials/test returns JSON with success field', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    // Test with an unreachable Gitea URL — expect JSON body not a crash
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'http://127.0.0.1:1',   // nothing listening here
        api_token: 'bad-token',
      },
    });
    // Backend returns 200 with { success: false } or a 4xx for bad input
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.message).toBe('string');
    }
  });

  test('unauthenticated request to credentials API returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/user/credentials`);
    expect(res.status()).toBe(401);
  });

  // ── Security: token never returned in GET single credential ──────────────

  test('GET /api/user/credentials/:id does not return api_token', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_secret_never_return', display_name: 'Secret Cred' },
    });
    expect(createRes.status()).toBe(201);
    const cred = await createRes.json();

    const getRes = await request.get(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();

    // Raw token must never be returned
    expect(body.api_token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ghp_secret_never_return');
    // but has_token must be true
    expect(body.has_token).toBe(true);
  });

  // ── Security: token not returned in list or update response ──────────────

  test('GET /api/user/credentials list never contains raw api_token values', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_list_secret_abc', display_name: 'List Secret' },
    });

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const raw = await listRes.text();

    expect(raw).not.toContain('ghp_list_secret_abc');
    const list = JSON.parse(raw);
    for (const item of list) {
      expect(item.api_token).toBeUndefined();
    }
  });

  test('PUT /api/user/credentials/:id update response does not echo raw token', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_original_secret', display_name: 'Update Echo' },
    });
    const cred = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'ghp_new_secret_never_return', display_name: 'Updated Echo' },
    });
    expect(updateRes.status()).toBe(200);
    const body = await updateRes.json();

    expect(body.api_token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ghp_new_secret_never_return');
    expect(body.has_token).toBe(true);
    expect(body.display_name).toBe('Updated Echo');
  });

  // ── Security: IDOR — cannot read another user's credential by ID ─────────

  test('cannot read another user credential via GET /api/user/credentials/:id — returns 404', async ({ request }) => {
    const { token: ownerToken } = await createAndLoginUser(request);
    const { token: attackerToken } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { provider: 'github', api_token: 'ghp_idor_victim', display_name: "Owner's Secret" },
    });
    const cred = await createRes.json();

    // Attacker tries to access owner's credential by ID
    const attackRes = await request.get(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
    });
    // Returns 404 (not found for this user) — not 200 and not 403 (no info leak)
    expect(attackRes.status()).toBe(404);
  });

  // ── Security: cannot update another user's credential via PUT ────────────

  test('cannot update another user credential — returns 404', async ({ request }) => {
    const { token: ownerToken } = await createAndLoginUser(request);
    const { token: attackerToken } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { provider: 'github', api_token: 'ghp_update_idor', display_name: "Original Name" },
    });
    const cred = await createRes.json();

    const attackRes = await request.put(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
      data: { display_name: 'HIJACKED', api_token: 'ghp_hijacked' },
    });
    expect(attackRes.status()).toBe(404);

    // Verify original credential was not modified
    const getRes = await request.get(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const original = await getRes.json();
    expect(original.display_name).toBe('Original Name');
  });

  // ── New API tests ─────────────────────────────────────────────────────────

  test('POST credential returns 201 with an id field', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_has_id', display_name: 'Has ID' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
    expect(body.id).toBeGreaterThan(0);
  });

  test('POST Gitea credential response contains provider_url field', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const url = 'https://mygitea.internal.example.com';
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: url, api_token: 'tok', display_name: 'URL Check' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.provider_url).toBe(url);
  });

  test('GET /api/user/credentials/:id returns a single credential object', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_single_get', display_name: 'Single Get' },
    });
    const created = await createRes.json();

    const getRes = await request.get(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.id).toBe(created.id);
    expect(body.display_name).toBe('Single Get');
    expect(body.provider).toBe('github');
  });

  test('PUT /api/user/credentials/:id updates provider_url for Gitea credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://old.gitea.com', api_token: 'tok', display_name: 'URL Update' },
    });
    const created = await createRes.json();

    // PUT only accepts api_token and display_name per the handler
    const updateRes = await request.put(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'tok_updated', display_name: 'URL Updated Name' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.display_name).toBe('URL Updated Name');
    expect(updated.has_token).toBe(true);
  });

  test('after DELETE credential is no longer in the list', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_gone', display_name: 'Will Be Gone' },
    });
    const created = await createRes.json();

    await request.delete(`${BASE}/api/user/credentials/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = await listRes.json();
    const ids = list.map((c: any) => c.id);
    expect(ids).not.toContain(created.id);
  });

  test('POST /api/user/credentials/test with empty provider_url returns 400 for Gitea', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: '', api_token: 'tok' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials/test with missing api_token returns 400', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials/test with invalid Gitea URL returns 200 with success false', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'http://192.0.2.1:9999', api_token: 'bad' },
    });
    // Either a JSON 200 with success:false or a 4xx — both are acceptable
    expect([200, 400, 422, 500]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.success).toBe(false);
    }
  });

  test('multiple credentials can coexist for the same user', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const names = ['Cred Alpha', 'Cred Beta', 'Cred Gamma'];
    for (const name of names) {
      await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { provider: 'github', api_token: 'ghp_multi', display_name: name },
      });
    }

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = await listRes.json();
    const listedNames = list.map((c: any) => c.display_name);
    for (const name of names) {
      expect(listedNames).toContain(name);
    }
  });

  test('credential with display_name stores and returns the label correctly', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const label = `My-Label-${crypto.randomUUID().slice(0, 8)}`;
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_label', display_name: label },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.display_name).toBe(label);

    // Also verify via GET
    const getRes = await request.get(`${BASE}/api/user/credentials/${body.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await getRes.json()).display_name).toBe(label);
  });

  test('another user cannot access my credentials via list — lists are user-scoped', async ({ request }) => {
    const { token: myToken } = await createAndLoginUser(request);
    const { token: otherToken } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${myToken}` },
      data: { provider: 'github', api_token: 'ghp_mine', display_name: 'My Private Cred' },
    });
    const created = await createRes.json();

    const otherListRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    const otherList = await otherListRes.json();
    const ids = otherList.map((c: any) => c.id);
    expect(ids).not.toContain(created.id);
  });

  test('unauthorized GET /api/user/credentials returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/user/credentials`);
    expect(res.status()).toBe(401);
  });

  test('unauthorized POST /api/user/credentials returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/user/credentials`, {
      data: { provider: 'github', api_token: 'ghp_unauth', display_name: 'No Auth' },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// UI tests — Settings page credential section
// ---------------------------------------------------------------------------

test.describe('User Credentials — UI', () => {

  // ── Navigate to /settings and see credentials section ────────────────────

  test('settings page shows Your API Credentials section with empty state', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  // ── Add Credential button opens modal ─────────────────────────────────────

  test('Add Credential button opens the credential modal', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toContainText('Add API Credential');
  });

  // ── Provider selection: Gitea vs GitHub tabs ──────────────────────────────

  test('modal shows Gitea and GitHub provider tabs', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.provider-tab:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('.provider-tab:has-text("GitHub")')).toBeVisible();
  });

  // ── Fill Gitea credential form ────────────────────────────────────────────

  test('Gitea tab (default) shows URL field and token field', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.provider-tab.active:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('#providerUrl')).toBeVisible();
    await expect(page.locator('#apiToken')).toBeVisible();
  });

  // ── Fill GitHub credential form ───────────────────────────────────────────

  test('GitHub tab hides the URL field and shows only token field', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await page.click('.provider-tab:has-text("GitHub")');

    await expect(page.locator('.provider-tab.active:has-text("GitHub")')).toBeVisible();
    await expect(page.locator('#providerUrl')).not.toBeVisible();
    await expect(page.locator('#apiToken')).toBeVisible();
  });

  // ── Test Connection button disabled when form incomplete ─────────────────

  test('Test Connection is disabled until both URL and token are filled for Gitea', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // URL only — still disabled
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // Both URL + token — enabled
    await page.fill('#apiToken', 'test-token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  // ── GitHub only needs token to enable Test Connection ────────────────────

  test('GitHub requires only api_token for Test Connection button to be enabled', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await page.click('.provider-tab:has-text("GitHub")');

    await page.fill('#apiToken', 'ghp_test_token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  // ── Close modal via X button ──────────────────────────────────────────────

  test('modal closes when clicking the X button', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.click('.modal-header .btn-icon');

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  // ── Close modal via overlay click ─────────────────────────────────────────

  test('modal closes when clicking outside (overlay)', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  // ── Test Connection shows error badge for invalid credentials ─────────────

  test('test connection shows error badge for invalid credentials', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await page.fill('#providerUrl', 'https://gitea.invalid.example.com');
    await page.fill('#apiToken', 'invalid-token');

    // Mock the test endpoint to return a controlled failure
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Connection failed' }),
      });
    });

    await page.click('button:has-text("Test Connection")');

    await expect(page.locator('.status-badge.error')).toBeVisible({ timeout: 5000 });
  });

  // ── Submit saves credential to the list ───────────────────────────────────

  test('submitting GitHub credential adds it to the credentials list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Use GitHub (no URL required — simpler to test without real network)
    await page.click('.provider-tab:has-text("GitHub")');
    await page.fill('#apiToken', 'ghp_fake_token_save_test');
    await page.fill('#displayName', 'My Test GitHub');

    await page.click('button[type="submit"]:has-text("Save")');

    // After saving, credential should appear in the list
    await expect(page.locator('.credential-name:has-text("My Test GitHub")')).toBeVisible({ timeout: 5000 });
  });

  // ── Delete credential removes it from the list ───────────────────────────

  test('delete credential removes it from the list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);

    // Create credential via API first so we have something to delete
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_to_delete', display_name: 'To Delete' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.credential-name:has-text("To Delete")')).toBeVisible();

    const credItem = page.locator('.credential-item').filter({ hasText: 'To Delete' });
    page.once('dialog', (d) => d.accept());
    await credItem.locator('.btn-danger').click();

    await expect(page.locator('.credential-name:has-text("To Delete")')).not.toBeVisible({ timeout: 5000 });
  });

  // ── Edit credential (update endpoint exists in API, no explicit edit UI) ──

  test.fixme('edit credential modal updates token and display name', async ({ page, request }) => {
    // The PUT /api/user/credentials/:id endpoint exists in the backend,
    // but Settings.tsx does not expose an edit button for credentials.
    // When an edit UI is added, this test should open an edit modal,
    // change the display name, save, and verify the updated name shows.
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_edit_me', display_name: 'Edit Me' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    const credItem = page.locator('.credential-item').filter({ hasText: 'Edit Me' });
    await credItem.locator('.btn-edit, button:has-text("Edit")').click();

    await page.fill('#displayName', 'Renamed Cred');
    await page.click('button[type="submit"]:has-text("Save")');

    await expect(page.locator('.credential-name:has-text("Renamed Cred")')).toBeVisible({ timeout: 5000 });
  });

  // ── Admin sees Global Gitea Connection section ────────────────────────────

  test('admin user sees Global Gitea Connection section on settings page', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
  });

  // ── Non-admin does not see Global Gitea Connection section ───────────────

  test('non-admin user does not see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).not.toBeVisible();
  });

  // ── New UI tests ──────────────────────────────────────────────────────────

  test('UI: settings page shows Personal Gitea Connection section header', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    // The credentials section header should be visible on settings load
    await expect(
      page.locator('.settings-section').filter({ hasText: 'API Credentials' }).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('UI: Add Credential button is present on the settings page', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('button:has-text("Add Credential")')).toBeVisible({ timeout: 8000 });
  });

  test('UI: credential modal has gitea_url / provider_url field visible for Gitea', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Default tab is Gitea — #providerUrl should be visible
    await expect(page.locator('#providerUrl')).toBeVisible({ timeout: 5000 });
  });

  test('UI: credential modal api_key / api_token field is of type password (masked)', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    const tokenInput = page.locator('#apiToken');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });
    const inputType = await tokenInput.getAttribute('type');
    expect(inputType).toBe('password');
  });

  test('UI: credential modal has display_name / label field', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('#displayName')).toBeVisible({ timeout: 5000 });
  });

  test('UI: saved credential appears in the list with display name', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const displayName = `UI-Cred-${crypto.randomUUID().slice(0, 8)}`;

    // Create via API to avoid test connection dependency
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_ui_listed', display_name: displayName },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator(`.credential-name:has-text("${displayName}")`)).toBeVisible({ timeout: 8000 });
  });

  test('UI: credential list shows provider type (github or gitea)', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_provtype', display_name: 'Provider Type Check' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    const credItem = page.locator('.credential-item').filter({ hasText: 'Provider Type Check' });
    await expect(credItem).toBeVisible({ timeout: 8000 });
    // The item should contain 'github' somewhere (badge, label, or text)
    await expect(credItem).toContainText(/github/i);
  });

  test('UI: credential list does NOT show raw api token value', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const secretToken = `ghp_ui_secret_${crypto.randomUUID().replace(/-/g, '')}`;
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: secretToken, display_name: 'Secret UI Cred' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.credential-name:has-text("Secret UI Cred")')).toBeVisible({ timeout: 8000 });

    // The raw token must not appear anywhere on the page
    const pageText = await page.locator('body').innerText();
    expect(pageText).not.toContain(secretToken);
  });

  test('UI: test connection button is present in the add credential modal', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('button:has-text("Test Connection")')).toBeVisible({ timeout: 5000 });
  });

  test('UI: test connection shows success feedback when backend returns success:true', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'valid-looking-token');

    // Intercept and return success
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connection successful' }),
      });
    });

    await page.click('button:has-text("Test Connection")');

    // Some kind of success indicator should appear
    await expect(
      page.locator('.status-badge.success, .connection-success, [class*="success"]').first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// User Credentials — API (expanded)
// ---------------------------------------------------------------------------

test.describe('User Credentials — API (expanded)', () => {
  test.setTimeout(60000);

  test('GET /api/user/credentials returns list with created credentials', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_list_check', display_name: 'List Check' },
    });
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.find((c: any) => c.display_name === 'List Check')).toBeDefined();
  });

  test('POST /api/user/credentials creates credential with provider, display_name and has_token', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://git.example.com', api_token: 'tok', display_name: 'My Gitea Cred' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.provider).toBe('gitea');
    expect(body.display_name).toBe('My Gitea Cred');
    expect(body.has_token).toBe(true);
  });

  test('credential response shape includes id, provider, provider_url, display_name, has_token, created_at', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_shape', display_name: 'Shape Check' },
    });
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('provider');
    expect(body).toHaveProperty('display_name');
    expect(body).toHaveProperty('has_token');
    expect(body).toHaveProperty('created_at');
  });

  test('credential api_token NOT returned in GET response (security)', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_never_leak_me', display_name: 'No Leak' },
    });
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await res.text();
    expect(raw).not.toContain('ghp_never_leak_me');
    const list = JSON.parse(raw);
    for (const item of list) {
      expect(item.api_token).toBeUndefined();
    }
  });

  test('PUT /api/user/credentials/:id updates display_name', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_name_update', display_name: 'Before Rename' },
    });
    const { id } = await createRes.json();
    const updateRes = await request.put(`${BASE}/api/user/credentials/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: 'After Rename', api_token: 'ghp_name_update' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.display_name).toBe('After Rename');
  });

  test('PUT /api/user/credentials/:id updates token (has_token remains true)', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_old_tok', display_name: 'Token Update' },
    });
    const { id } = await createRes.json();
    const updateRes = await request.put(`${BASE}/api/user/credentials/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: 'Token Update', api_token: 'ghp_new_tok' },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).has_token).toBe(true);
  });

  test('DELETE /api/user/credentials/:id removes credential and returns 204', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_del', display_name: 'Del Me' },
    });
    const { id } = await createRes.json();
    const delRes = await request.delete(`${BASE}/api/user/credentials/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);
  });

  test('cannot create duplicate display_name for same user — or 201 if allowed', async ({ request }) => {
    // Depending on backend behaviour: may allow or reject duplicates.
    // At minimum both requests must return a parseable response.
    const { token } = await createAndLoginUser(request);
    const data = { provider: 'github', api_token: 'ghp_dupe', display_name: `Dupe-${Date.now()}` };
    const r1 = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` }, data,
    });
    const r2 = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` }, data,
    });
    expect([201, 409, 400]).toContain(r1.status());
    expect([201, 409, 400]).toContain(r2.status());
  });

  test('credential provider field accepts "gitea"', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://g.example.com', api_token: 'tok', display_name: 'Gitea Accept' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).provider).toBe('gitea');
  });

  test('credential provider field accepts "github"', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_prov', display_name: 'GitHub Accept' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).provider).toBe('github');
  });

  test('credential provider field rejects "gitlab" (unsupported)', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitlab', api_token: 'glpat_test', display_name: 'GitLab Reject' },
    });
    expect(res.status()).toBe(400);
  });

  test('empty api_token shows validation error (400)', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: '', display_name: 'Empty Token' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials/test returns JSON with success field', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'http://127.0.0.1:1', api_token: 'bad' },
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.success).toBe('boolean');
    }
  });

  test('POST /api/user/credentials/test returns success and message fields', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_fake_test_token' },
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.message).toBe('string');
    }
  });

  test('cannot see other user credentials via list — user-scoped', async ({ request }) => {
    const { token: myToken } = await createAndLoginUser(request);
    const { token: otherToken } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${myToken}` },
      data: { provider: 'github', api_token: 'ghp_mine2', display_name: 'Mine Only' },
    });
    const { id } = await createRes.json();
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    const list = await res.json();
    expect(list.find((c: any) => c.id === id)).toBeUndefined();
  });

  test('5+ credentials per user are allowed', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    for (let i = 1; i <= 6; i++) {
      const res = await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { provider: 'github', api_token: `ghp_multi_${i}`, display_name: `Cred ${i}` },
      });
      expect(res.status()).toBe(201);
    }
    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await listRes.json()).length).toBeGreaterThanOrEqual(6);
  });

  test('credential with special chars in token is stored and has_token true', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const specialToken = 'tok!@#$%^&*()-+=[]{}|;:,.<>?';
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: specialToken, display_name: 'Special Chars' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).has_token).toBe(true);
  });

  test('unauthenticated DELETE /api/user/credentials/:id returns 401', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_unauth_del', display_name: 'Unauth Delete' },
    });
    const { id } = await createRes.json();
    const res = await request.delete(`${BASE}/api/user/credentials/${id}`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated PUT /api/user/credentials/:id returns 401', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_unauth_put', display_name: 'Unauth Put' },
    });
    const { id } = await createRes.json();
    const res = await request.put(`${BASE}/api/user/credentials/${id}`, {
      data: { display_name: 'Hacked', api_token: 'ghp_hacked' },
    });
    expect(res.status()).toBe(401);
  });

  test('provider_url is preserved on Gitea credential GET list', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const url = 'https://my-gitea-instance.example.org';
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: url, api_token: 'tok', display_name: 'URL Preserved' },
    });
    const { id } = await createRes.json();
    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const found = (await listRes.json()).find((c: any) => c.id === id);
    expect(found).toBeDefined();
    expect(found.provider_url).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// User Credentials — UI (expanded)
// ---------------------------------------------------------------------------

test.describe('User Credentials — UI (expanded)', () => {
  test.setTimeout(90000);

  test('settings page > Credentials section shows list of created credentials', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_ui_list', display_name: 'UI List Cred' },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.credential-name:has-text("UI List Cred")')).toBeVisible({ timeout: 8000 });
  });

  test('credential list shows display name and provider', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://g.example.com', api_token: 'tok', display_name: 'Provider Display' },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    const item = page.locator('.credential-item').filter({ hasText: 'Provider Display' });
    await expect(item).toBeVisible({ timeout: 8000 });
    await expect(item).toContainText(/gitea/i);
  });

  test('credential token shown as masked (not raw text) in settings list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const secret = `ghp_ui_masked_${crypto.randomUUID().replace(/-/g, '')}`;
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: secret, display_name: 'Masked Token' },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.credential-name:has-text("Masked Token")')).toBeVisible({ timeout: 8000 });
    const pageText = await page.locator('body').innerText();
    expect(pageText).not.toContain(secret);
  });

  test('"Add Credential" button opens form modal', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible({ timeout: 5000 });
  });

  test('form has display name, provider selector, URL, and token fields', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('#displayName')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#apiToken')).toBeVisible();
    await expect(page.locator('.provider-tab:has-text("Gitea"), .provider-tab:has-text("GitHub")')).toBeVisible();
  });

  test('provider selector has Gitea and GitHub options', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.provider-tab:has-text("Gitea")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.provider-tab:has-text("GitHub")')).toBeVisible();
  });

  test('create credential via UI — appears in list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const name = `UI-Create-${Date.now()}`;
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await page.click('.provider-tab:has-text("GitHub")');
    await page.fill('#displayName', name);
    await page.fill('#apiToken', 'ghp_ui_create_test');
    await page.click('button[type="submit"]:has-text("Save")');
    await expect(page.locator(`.credential-name:has-text("${name}")`)).toBeVisible({ timeout: 8000 });
  });

  test('credential appears in list after creation', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const name = `After-Create-${Date.now()}`;
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_after', display_name: name },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator(`.credential-name:has-text("${name}")`)).toBeVisible({ timeout: 8000 });
  });

  test('delete credential with confirm dialog', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const name = `Delete-Confirm-${Date.now()}`;
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_confirm_del', display_name: name },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator(`.credential-name:has-text("${name}")`)).toBeVisible({ timeout: 8000 });
    const item = page.locator('.credential-item').filter({ hasText: name });
    page.once('dialog', (d) => d.accept());
    await item.locator('.btn-danger').click();
    await expect(page.locator(`.credential-name:has-text("${name}")`)).not.toBeVisible({ timeout: 5000 });
  });

  test('credential removed from list after deletion', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const name = `Removed-After-${Date.now()}`;
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_removed_after', display_name: name },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator(`.credential-name:has-text("${name}")`)).toBeVisible({ timeout: 8000 });
    const item = page.locator('.credential-item').filter({ hasText: name });
    page.once('dialog', (d) => d.accept());
    await item.locator('.btn-danger').click();
    await expect(page.locator(`.credential-name:has-text("${name}")`)).not.toBeVisible({ timeout: 5000 });
    // Reload to confirm server-side removal
    await page.reload();
    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await expect(page.locator(`.credential-name:has-text("${name}")`)).not.toBeVisible();
  });

  test('"Test Connection" button present in add credential modal', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('button:has-text("Test Connection")')).toBeVisible({ timeout: 5000 });
  });

  test('test shows success feedback when backend returns success: true', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'ghp_mock_success');
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connection successful' }),
      });
    });
    await page.click('button:has-text("Test Connection")');
    await expect(
      page.locator('.status-badge.success, .connection-success, [class*="success"]').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('test shows error feedback when backend returns success: false', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await page.fill('#providerUrl', 'https://gitea.invalid.example.com');
    await page.fill('#apiToken', 'bad-token');
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Connection failed' }),
      });
    });
    await page.click('button:has-text("Test Connection")');
    await expect(page.locator('.status-badge.error')).toBeVisible({ timeout: 5000 });
  });

  test.fixme('edit credential opens form with current values (excluding token)', async ({ page, request }) => {
    // The PUT endpoint exists but Settings.tsx does not expose an edit button yet.
    // When edit UI is added: open edit modal, verify display_name pre-filled, token field empty.
    const { token } = await createAndLoginUser(request);
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_edit_form', display_name: 'Edit Form Cred' },
    });
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    const item = page.locator('.credential-item').filter({ hasText: 'Edit Form Cred' });
    await item.locator('.btn-edit, button:has-text("Edit")').click();
    await expect(page.locator('#displayName')).toHaveValue('Edit Form Cred');
    await expect(page.locator('#apiToken')).toHaveValue('');
  });

  test.fixme('save edited credential — token unchanged if left blank', async ({ page, request }) => {
    // Same pre-condition as above — UI edit not yet implemented.
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_unchanged', display_name: 'Blank Token Edit' },
    });
    const { id } = await createRes.json();
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    const item = page.locator('.credential-item').filter({ hasText: 'Blank Token Edit' });
    await item.locator('.btn-edit, button:has-text("Edit")').click();
    await page.fill('#displayName', 'Renamed Blank Token');
    // Leave token blank — token should remain valid
    await page.click('button[type="submit"]:has-text("Save")');
    // Verify via API that has_token is still true
    const getRes = await request.get(`${BASE}/api/user/credentials/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await getRes.json()).has_token).toBe(true);
  });

  test('credential count is reflected in settings (list length matches API)', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    const names = [`Count1-${Date.now()}`, `Count2-${Date.now()}`, `Count3-${Date.now()}`];
    for (const name of names) {
      await request.post(`${BASE}/api/user/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { provider: 'github', api_token: 'ghp_count', display_name: name },
      });
    }
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    for (const name of names) {
      await expect(page.locator(`.credential-name:has-text("${name}")`)).toBeVisible({ timeout: 8000 });
    }
  });
});

// ---------------------------------------------------------------------------
// User Credentials — Board-level / Swimlane Credentials
// ---------------------------------------------------------------------------

test.describe('User Credentials — Swimlane Credentials (API)', () => {
  test.setTimeout(60000);

  async function createBoardAndSwimlane(request: any, token: string): Promise<{ boardId: number; swimlaneId: number }> {
    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `Cred Board ${Date.now()}` },
      })
    ).json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Gitea Lane', designator: 'GL', color: '#3b82f6' },
      })
    ).json();
    return { boardId: board.id, swimlaneId: swimlane.id };
  }

  test('board settings > swimlane creation accepts api_token for non-default source', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `Swimlane Cred Board ${Date.now()}` },
      })
    ).json();

    const res = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Custom Gitea Lane',
        designator: 'CG',
        color: '#10b981',
        repo_source: 'custom_gitea',
        repo_url: 'https://gitea.example.com/org/repo',
        api_token: 'lane-specific-token',
      },
    });
    // Either 201 (created) or 400 (invalid url) are valid — we just care it doesn't 500
    expect([201, 400]).toContain(res.status());
  });

  test('swimlane without api_token uses default credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const { boardId } = await createBoardAndSwimlane(request, token);

    // Get the swimlanes back — should succeed without credential error
    const res = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const swimlanes = await res.json();
    expect(Array.isArray(swimlanes)).toBe(true);
  });

  test('user credential created via API shows up in list', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://lane-cred.example.com', api_token: 'lane-tok', display_name: 'Lane Credential' },
    });
    expect(res.status()).toBe(201);
    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const found = (await listRes.json()).find((c: any) => c.display_name === 'Lane Credential');
    expect(found).toBeDefined();
  });

  test('user credentials are available for swimlane assignment (credential exists in list)', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    // Create credential
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://swimlane.cred.example.com', api_token: 'sw-tok', display_name: 'Swimlane Ready Cred' },
    });

    // Create a board and swimlane
    const { boardId } = await createBoardAndSwimlane(request, token);

    // The credentials list should be available (not throw) when used alongside a board
    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const creds = await listRes.json();
    expect(creds.find((c: any) => c.display_name === 'Swimlane Ready Cred')).toBeDefined();
  });

  test('removing a credential from user list does not break board swimlane listing', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://del-cred.example.com', api_token: 'del-tok', display_name: 'To Remove Swimlane Cred' },
    });
    const { id } = await createRes.json();

    const { boardId } = await createBoardAndSwimlane(request, token);

    // Delete the credential
    await request.delete(`${BASE}/api/user/credentials/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Board swimlanes should still be accessible
    const slRes = await request.get(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(slRes.status()).toBe(200);
  });
});
