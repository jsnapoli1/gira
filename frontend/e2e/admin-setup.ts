import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_AUTH_FILE = path.join(process.cwd(), 'test-results', '.admin-auth.json');

/**
 * This setup runs before all other tests (single worker, serial).
 * It creates a user and promotes them to admin via the promote-admin endpoint.
 */
setup('create admin user', async ({ page, request }) => {
  const adminEmail = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const adminPassword = 'adminpass123';

  await page.goto('/signup');
  await page.fill('#displayName', 'Admin User');
  await page.fill('#email', adminEmail);
  await page.fill('#password', adminPassword);
  await page.fill('#confirmPassword', adminPassword);
  await page.click('button[type="submit"]');
  // Signup redirects to /boards (not /dashboard)
  await page.waitForURL(/\/boards/, { timeout: 10000 });

  // Get JWT token and promote to admin
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const backendPort = process.env.PORT || '9002';
  const promoteRes = await request.post(`http://localhost:${backendPort}/api/auth/promote-admin`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!promoteRes.ok()) {
    console.log('Warning: promote-admin returned', promoteRes.status());
  }

  // Save admin credentials
  const dir = path.dirname(ADMIN_AUTH_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify({ email: adminEmail, password: adminPassword }));
});
