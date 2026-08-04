import { test, expect } from '@playwright/test';

test('page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BENLEO VERLAG/);
});

test('shared nav is injected with links', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.nav-links a');
  const links = await page.locator('.nav-links a').count();
  expect(links).toBeGreaterThanOrEqual(4);
});

test('lucide icons initialized', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('svg[data-lucide]');
  const icons = await page.locator('svg[data-lucide]').count();
  expect(icons).toBeGreaterThan(0);
});

test('footer legal links point to bornhaeusser-friends.com', async ({ page }) => {
  await page.goto('/');
  for (const slug of ['impressum', 'datenschutz', 'agb']) {
    const href = await page.locator(`footer a[href*="${slug}"]`).first().getAttribute('href');
    expect(href).toContain('bornhaeusser-friends.com');
  }
});

test('presse page loads', async ({ page }) => {
  await page.goto('/presse.html');
  await expect(page).toHaveTitle(/Presse.*BENLEO/);
});

test('team page loads', async ({ page }) => {
  await page.goto('/team.html');
  await expect(page).toHaveTitle(/Team.*BENLEO/);
});

test('subpages load', async ({ page }) => {
  for (const [path, re] of [
    ['/ueber-uns.html', /Über uns.*BENLEO/],
    ['/programm.html', /Programm.*BENLEO/],
    ['/veranstaltungen.html', /Kulturveranstaltungen.*BENLEO/],
    ['/teil-werden.html', /Teil werden.*BENLEO/],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(re);
    await page.waitForSelector('.nav-links a');
  }
});

test('language toggle switches DE <-> EN', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.nav-right .lang-btn[data-lang-set="en"]');
  await page.locator('.nav-right .lang-btn[data-lang-set="de"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'de');
  await expect(page.locator('.nav-links a[href="ueber-uns.html"]')).toHaveText('Über uns');

  await page.locator('.nav-right .lang-btn[data-lang-set="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
  await expect(page.locator('.nav-links a[href="ueber-uns.html"]')).toHaveText('About');

  await page.reload();
  await page.waitForSelector('.nav-links a');
  await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
});

test('language toggle present in nav', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.nav-right .lang-btn');
  expect(await page.locator('.nav-right .lang-btn').count()).toBe(2);
});
