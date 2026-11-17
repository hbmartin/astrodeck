# AstroDeck starter kit

Start with the [first PR checklist](FIRST-PR-CHECKLIST.md), the [project brief](PROJECT.md), and
the [agent rules](AGENTS.md). The tools here are already part of AstroDeck and survive demo cleanup.

## SEO and responsive images

Set the production origin in the [site URL config](src/config/site-url.mjs). The shared head owns
titles, canonicals, robots directives, and social tags. Pass plain titles to layouts. A page may
pass an image path or `image={{ path, alt, width, height }}` to the layout. Use a same-origin path
and real dimensions for the object form. Set `noindex` on deliberately unlisted pages and exclude
those pages from the sitemap. If content must be private, require access or omit it from the build.

For responsive images with known intrinsic dimensions, [bounded widths](src/lib/starter/image-widths.mjs)
keeps only suitable candidates. An empty result means the asset is too small for the candidate
list; render its original size without a width-based srcset.

## Hosted links

The optional header CTA uses [the hosted action helper](src/lib/starter/hosted-action.mjs). See the
[porting guide](docs/STARTER-PORTING.md) for setting the approved origins and a real internal
fallback. The default demo and cleaned starter ship without the option set.

## Build, host, and browser checks

```sh
pnpm run verify
pnpm run check:host https://your-preview.example
pnpm exec playwright install chromium firefox webkit
pnpm run test:e2e:smoke
```

[Site checks](site-checks.json) declares the homepage and 404 expectations. The pages list extends
the existing generated HTML checks in `check:dist`; the responses list is used by `check:host` for
actual HTTP status, Location, optional headers and page markers. Keep these expectations in sync
with deliberate changes to the site. The host smoke uses read-only GETs and no credentials;
it accepts HTTPS origins or local loopback HTTP. It does not follow redirects. For protected
previews, use your approved browser access method and the [QA guide](docs/STARTER-QA.md).

The opt-in browser check uses the existing build. Run `pnpm run build` first if it is absent
or stale. Playwright owns a foreground Astro preview on loopback port 4329 and records traces on
failure. Set `PLAYWRIGHT_BASE_URL` to target an already running server instead. Local preview
checks browser behavior; use the hosted smoke to verify the actual deployment.
