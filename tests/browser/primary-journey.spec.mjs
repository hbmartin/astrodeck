import { expect, test } from '@playwright/test';

test('a mobile visitor can return home from the custom 404', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const response = await page.goto('/starter-smoke-missing/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();

  const home = page.getByRole('link').and(page.locator('[data-not-found-home]'));
  await expect(home).toHaveAttribute('href', '/');
  await expect(home).toHaveAccessibleName(/\S/u);
  await home.click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toHaveCount(0);
});
