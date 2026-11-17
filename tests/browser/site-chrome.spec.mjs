// Interactive parts of the shared layout: mobile menu, theme toggle and skip link.
// Selectors use ids, roles and hrefs, not English text, because sites translate src/config/ui.ts.
import { expect, test } from '@playwright/test';

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the menu button opens and closes the mobile menu by click and keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.locator('#mobile-menu-button');
    const menu = page.locator('#mobile-menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link').first()).toBeVisible();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
  });
});

test.describe('in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('the theme toggle switches to dark and remembers the choice', async ({ page }) => {
    await page.goto('/');
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

test('the skip link is the first tab stop and jumps to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.locator('a[href="#main-content"]');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
});
