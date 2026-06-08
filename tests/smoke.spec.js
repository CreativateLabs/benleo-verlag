import { test, expect } from '@playwright/test';

test('page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BENLEO VERLAG/);
});

test('all nav links present', async ({ page }) => {
  await page.goto('/');
  const links = await page.locator('.nav-links a').count();
  expect(links).toBeGreaterThanOrEqual(4);
});

test('lucide icons initialized', async ({ page }) => {
  await page.goto('/');
  const icons = await page.locator('svg[data-lucide]').count();
  expect(icons).toBeGreaterThan(0);
});

test('footer impressum link correct', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('footer a[href*="impressum"]').first().getAttribute('href');
  expect(href).toContain('bornhaeusser-friends.com');
});

test('footer datenschutz link correct', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('footer a[href*="datenschutz"]').first().getAttribute('href');
  expect(href).toContain('bornhaeusser-friends.com');
});

test('footer agb link correct', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('footer a[href*="agb"]').first().getAttribute('href');
  expect(href).toContain('bornhaeusser-friends.com');
});

test('presse page loads', async ({ page }) => {
  await page.goto('/presse.html');
  await expect(page).toHaveTitle(/Presse.*BENLEO/);
});

test('team page loads', async ({ page }) => {
  await page.goto('/team.html');
  await expect(page).toHaveTitle(/Team.*BENLEO/);
});
