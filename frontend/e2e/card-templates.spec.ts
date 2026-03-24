import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

async function setup(request: any) {
  const email = `test-tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Template Test Board' },
    })
  ).json();

  return { token, board };
}

async function createTemplate(
  request: any,
  token: string,
  boardId: number,
  name: string,
  descriptionTemplate = 'Steps to reproduce:\n1.\n2.',
  issueType = 'bug'
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/templates`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      issue_type: issueType,
      description_template: descriptionTemplate,
    },
  });
  return res.json();
}

test.describe('Card Templates', () => {
  // ── 1. Templates section visible ────────────────────────────────────────────
  test('templates section is visible in board settings', async ({ page, request }) => {
    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // The templates section does not exist in the current BoardSettings UI.
    // All template UI tests below are fixme'd accordingly.
    test.fixme(
      true,
      'Card Templates section is not implemented in BoardSettings.tsx — API exists but no UI'
    );
  });

  // ── 2. Create template ───────────────────────────────────────────────────────
  test('can create a card template via the settings form', async ({ page, request }) => {
    test.fixme(
      true,
      'Card Templates section is not implemented in BoardSettings.tsx — no Add Template button in UI'
    );

    const { token, board } = await setup(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const templatesSection = page.locator('.settings-section').filter({ hasText: 'Templates' });
    await templatesSection.locator('button:has-text("Add Template")').click();

    await page.locator('.modal input[placeholder*="name"], .modal input[name="name"]').fill('Bug Report Template');
    await page.locator('.modal textarea').fill('Steps to reproduce:\n1.\n2.');
    await page.locator('.modal button[type="submit"]').click();

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(templatesSection.locator(':has-text("Bug Report Template")')).toBeVisible();
  });

  // ── 3. Delete template ───────────────────────────────────────────────────────
  test('can delete a card template from the settings page', async ({ page, request }) => {
    test.fixme(
      true,
      'Card Templates section is not implemented in BoardSettings.tsx — no delete UI'
    );

    const { token, board } = await setup(request);
    await createTemplate(request, token, board.id, 'Delete Me Template');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const templatesSection = page.locator('.settings-section').filter({ hasText: 'Templates' });
    const templateRow = templatesSection
      .locator('.template-item, .settings-list-item')
      .filter({ hasText: 'Delete Me Template' });

    page.once('dialog', (d) => d.accept());
    await templateRow.locator('.item-delete, button[title*="Delete"], button[title*="delete"]').click();

    await expect(
      templatesSection.locator(':has-text("Delete Me Template")')
    ).not.toBeVisible();
  });

  // ── 4. Template list shows titles ────────────────────────────────────────────
  test('template list shows all template titles', async ({ page, request }) => {
    test.fixme(
      true,
      'Card Templates section is not implemented in BoardSettings.tsx — no template list UI'
    );

    const { token, board } = await setup(request);
    await createTemplate(request, token, board.id, 'Alpha Template');
    await createTemplate(request, token, board.id, 'Beta Template');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    const templatesSection = page.locator('.settings-section').filter({ hasText: 'Templates' });
    await expect(templatesSection.locator(':has-text("Alpha Template")')).toBeVisible();
    await expect(templatesSection.locator(':has-text("Beta Template")')).toBeVisible();
  });

  // ── 5. Use template to create card ───────────────────────────────────────────
  test('can apply a template when creating a card', async ({ page, request }) => {
    test.fixme(
      true,
      'Template-based card creation is not yet wired into the AddCardModal or quick-add flow'
    );
  });

  // ── API-level smoke test: templates CRUD works at the API layer ──────────────
  test('templates API: create, list, and delete work correctly', async ({ request }) => {
    const { token, board } = await setup(request);

    // Create
    const created = await createTemplate(request, token, board.id, 'API Smoke Template', 'Desc here');
    expect(created.id).toBeDefined();
    expect(created.name).toBe('API Smoke Template');
    expect(created.board_id).toBe(board.id);
    expect(created.description_template).toBe('Desc here');

    // List
    const listRes = await request.get(`${BASE}/api/boards/${board.id}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBe(true);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((t: any) => t.id === created.id)).toBe(true);

    // Delete
    const delRes = await request.delete(
      `${BASE}/api/boards/${board.id}/templates/${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(delRes.ok()).toBe(true);

    // Verify gone
    const listAfter = await (
      await request.get(`${BASE}/api/boards/${board.id}/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(listAfter.some((t: any) => t.id === created.id)).toBe(false);
  });
});
