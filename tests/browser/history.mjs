import { expect } from '@playwright/test';

function navigationUrl(link, home) {
  if (link.download || (link.target && link.target.toLowerCase() !== '_self')) return;
  const target = URL.parse(link.href, home);
  if (
    target &&
    ['http:', 'https:'].includes(target.protocol) &&
    target.origin === home.origin &&
    target.pathname !== home.pathname
  )
    return target;
}

function isHtmlDocument(status, headers, successful) {
  const disposition = headers['content-disposition']?.split(';', 1)[0].trim().toLowerCase();
  return (
    successful &&
    ![204, 205].includes(status) &&
    disposition !== 'attachment' &&
    /^\s*text\/html(?:\s*;|$)/iu.test(headers['content-type'] ?? '')
  );
}

async function isLocalHtml(request, target, home) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (target.origin !== home.origin) return false;
    const response = await request.get(target.href, { maxRedirects: 0, timeout: 5000 });
    const status = response.status();
    const headers = response.headers();
    const successful = response.ok();
    await response.dispose();
    if ([301, 302, 303, 307, 308].includes(status)) {
      if (!headers.location) return false;
      target = URL.parse(headers.location, target);
      if (!target) return false;
    } else {
      return target.pathname !== home.pathname && isHtmlDocument(status, headers, successful);
    }
  }
  return false;
}

/** Find a real document destination without navigating away from the homepage. */
export async function historyNavigation(page) {
  const home = new URL(page.url());
  const navigation = page.locator('header nav a[href]');
  const links = await navigation.evaluateAll((elements) =>
    elements.map((link) => ({
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
      download: link.hasAttribute('download'),
    }))
  );
  for (const [index, link] of links.entries()) {
    const target = navigationUrl(link, home);
    if (!target) continue;
    try {
      if (await isLocalHtml(page.request, target, home)) return navigation.nth(index);
    } catch {
      // A failed local probe is not an eligible document; ordinary link checks diagnose it.
    }
  }
}

async function pageState(page) {
  const heading = page.getByRole('main').getByRole('heading', { level: 1 });
  return { url: page.url(), title: await page.title(), heading: await heading.innerText() };
}

async function expectPageState(page, state) {
  await expect(page).toHaveURL(state.url);
  await expect(page).toHaveTitle(state.title);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
    state.heading,
    { useInnerText: true }
  );
}

/** Check URL and rendered document restoration, using consistent visible heading text. */
export async function checkBrowserHistory(page, navigation) {
  const home = await pageState(page);
  await navigation.click();
  await expect(page).not.toHaveURL(home.url);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  const onward = await pageState(page);

  await page.goBack();
  await expectPageState(page, home);
  await page.goForward();
  await expectPageState(page, onward);
}
