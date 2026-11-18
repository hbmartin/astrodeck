// The real homepage and the interactive parts of its shared layout.
// Selectors use ids, roles and hrefs because sites translate src/config/ui.ts.
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { checkBrowserHistory, historyNavigation } from './history.mjs';

async function openSharedLayout(page) {
  await page.goto('/');
  const minimal = await page.locator('main[data-layout="minimal"]').count();
  test.skip(
    minimal === 1 && process.env.ASTRODECK_KIT_CHECKS !== '1',
    'MinimalLayout intentionally omits the shared header, theme toggle and skip link.'
  );
}

async function expectMenuLinks(menu, hrefs) {
  for (const [index, href] of hrefs.entries()) {
    const link = menu.getByRole('link').nth(index);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toBeVisible();
  }
}

test('the homepage serves visible main content and a page heading', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the menu button opens and closes the mobile menu by click and keyboard', async ({
    page,
  }) => {
    await openSharedLayout(page);
    const button = page.locator('#mobile-menu-button');
    const menu = page.locator('#mobile-menu');
    const navigationHrefs = await page
      .locator('header nav a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expectMenuLinks(menu, navigationHrefs);

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expectMenuLinks(menu, navigationHrefs);

    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
  });
});

test.describe('in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('the theme toggle switches to dark and remembers the choice', async ({ page }) => {
    await openSharedLayout(page);
    const html = page.locator('html');
    const toggle = page.getByRole('banner').getByRole('switch');
    await expect(html).not.toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });
});

test('the skip link focuses the main content and preserves browser history', async ({ page }) => {
  await openSharedLayout(page);
  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute('id', 'main-content');
  await page.keyboard.press('Tab');
  const skip = page.locator('a[href="#main-content"]');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(main).toBeFocused();
  await expect.poll(() => page.evaluate(() => globalThis.history.state)).not.toBeNull();

  await test.step('Back and Forward restore the URL, title and heading', async (step) => {
    const navigation = await historyNavigation(page);
    const reason = 'No same-tab navigation link leads to another successful same-origin HTML page.';
    if (!navigation) console.log(`Back/Forward skipped: ${reason}`);
    step.skip(!navigation, reason);
    await checkBrowserHistory(page, navigation);
  });
});
