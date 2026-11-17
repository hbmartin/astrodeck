# AGENTS.md — AstroDeck

AstroDeck is a website starter built with Astro 7, Tailwind CSS 4, TypeScript and React islands.

## Site brief

Before changing the site, read [PROJECT.md](PROJECT.md). It takes precedence for site decisions
such as audience, brand, content and sitemap. Record new site decisions there and use `brief/`
for source material.

## Choose the workflow

Open the matching skill from `.agents/skills/<name>/SKILL.md` if it was not loaded automatically.

| Requested change | Skill or reference |
| --- | --- |
| Create a whole site or adapt the starter to a project | `astrodeck-build-site` |
| Add a page | `astrodeck-new-page` |
| Add a section or extend a registered section's props | `astrodeck-new-section` |
| Apply a brand, logo, palette, fonts or `DESIGN.md` to an existing site | `astrodeck-theme` |
| Remove the demo | `astrodeck-cleanup` |
| Edit copy, alt text or metadata | [Content rules](.agents/skills/astrodeck-build-site/references/content-rules.md) |
| Audit a site for launch | `vibe2prod` and the [quality checklist](.agents/skills/astrodeck-build-site/references/quality-checklist.md) |

For a whole-site build or requested demo removal, use the cleanup skill while `starter/` exists.
Cleanup replaces `PROJECT.md` and the site config, so preserve user edits before running it.

## Implementation rules

- Store brand, navigation, footer, social links and contact details in `src/config/site.ts`.
  Set the production URL in `src/config/site-url.mjs` and translate UI text in
  `src/config/ui.ts`. Pass a plain page title to the layout, which adds the brand.
- Compose pages from `src/registry.json` sections. Reuse a section through props, extending them
  as needed. Create and register a section only when the existing ones cannot serve the use case.
- Use semantic color tokens and change the palette with `pnpm run theme`. Use Tailwind's
  CSS-first setup in `src/styles/globals.css`. Keep raw palette classes, arbitrary colors,
  `text-white`, dark-mode color overrides and inline styles out of components.
- Import through `@/` and use `IconName` from `src/lib/icons.ts`. Render static content in
  `.astro` files. Hydrate React islands only for interactivity, using `client:visible` or
  `client:idle`. Reserve `client:load` for above-the-fold interactivity.
- Use supplied facts for copy and claims. Ask for missing testimonials, statistics, prices or
  contact details, or omit the affected content and record the gap under Open questions in
  `PROJECT.md`. Ship real content and working link and form destinations.
- Use one `h1` per page, ordered headings and meaningful alt text. Check phone layouts and
  readability in light and dark mode.

Read the [design system](.agents/skills/astrodeck-build-site/references/design-system.md)
before visual work. Consult the [Astro conventions](docs/agents/astro-conventions.md) when
changing Astro templates, configuration, content collections or Tailwind setup.

## Commands

Use macOS or Linux and pnpm for installs, lockfile updates and scripts. See `engines` and
`packageManager` in [package.json](package.json) for the required Node and pnpm versions.

- Run `pnpm install --frozen-lockfile` to set up dependencies.
- Start `pnpm run dev` in the background. Poll `/_astro/status` on the reported URL until it
  returns `{"ok":true}`. Stop the server when finished if you started it.
- Edit skill sources in `.agents/skills/`, then run `pnpm run sync:agents` to regenerate the
  mirror. Check drift with `pnpm run sync:agents --check`. The installer owns skills listed
  in `skills-lock.json`. Put Claude-only skills in their own folders under `.claude/skills/`.

See the [README command reference](README.md#commands) for other scripts.

## Verification and handover

- Run `pnpm run verify` for changes. After demo cleanup, use `pnpm run verify --starter` to
  also check for demo leftovers. The selected command must exit successfully and print
  `VERIFY PASSED`. The faster `pnpm run validate` skips the build and built-HTML checks.
- After changing the header, mobile menu, theme toggle or layouts, also run `pnpm run test:e2e`
  (once: `pnpm exec playwright install chromium`).
- Fix failures at their source. Keep tests, rules and generated output intact.
- For launch or whole-site handover, run vibe2prod and the manual items in the
  [quality checklist](.agents/skills/astrodeck-build-site/references/quality-checklist.md).
- Report the exact verification command, its result, and any checks that could not run.
  Push, publish or deploy only when the user asks.
