# First PR: set up a clean AstroDeck baseline

Fill in [PROJECT.md](PROJECT.md) and read [AGENTS.md](AGENTS.md). If the demo is present,
review `pnpm run starter:clean --dry-run` and preserve any brief edits before removing the demo.

**Scope:** establish project identity, a reproducible build, and a small public surface. Keep
unrelated feature work and framework upgrades in separate PRs.

For optional runnable checks and examples, see [the technical kit](STARTER-KIT.md).

## Before requesting review

- [ ] Fill in `PROJECT.md`: production origin, audience, primary action and fallback, launch
      routes, publishing intent, host, and launch boundaries. Resolve anything this PR depends on.
- [ ] Replace template identity across the repo: package metadata, layout defaults, canonical
      origin, titles, social preview metadata and images, favicon, manifest, and structured data
      where used. Search for leftover template names and domains.
- [ ] Remove or intentionally retain demo routes, test pages, navigation links, placeholder
      copy, and sample assets. Check sitemap and feeds if enabled. Ensure no private drafts are
      emitted as publicly reachable pages.
- [ ] Pin a supported runtime, track the correct lockfile, and document the clean install,
      validation, and production build commands. Use `pnpm install --frozen-lockfile`.
- [ ] Keep local secrets and generated files out of Git. If configuration is needed, provide
      safe example values or blanks. Check that optional integrations are off or have safe preview
      settings and useful fallbacks.
- [ ] Run `pnpm run verify --starter` after cleanup to check source, tests, and the production build. Verify the build has the expected pages, no unwanted demo pages, and correct identity
      and indexability in the emitted HTML. Inspect the generated sitemap if enabled.
- [ ] Smoke-test one representative page at narrow and wide widths. Check keyboard access,
      visible focus, navigation, and the primary action or fallback if included. Check both themes
      if supported. Run affected browser tests when behavior changes.
- [ ] Establish a reliable required CI check for validation and build if CI is available.
      If the runner or budget is unavailable, record the blocker and the exact local evidence.
      Give any follow-up required for launch an owner.

## First hosted preview, when available

Use one candidate URL for both the browser smoke and the HTTP checks. If the first PR is only a
baseline and cannot get a hosted preview yet, record it as **not run** and carry this section
into the first hosted PR.

- [ ] Confirm preview access and indexing match the intended policy. Verify that the browser
      reached the page itself rather than an authentication screen.
- [ ] Check the representative page's response, one expected redirect if configured, and an
      unknown URL for the intended status and error page. Check the headers and representative
      asset responses the project depends on, including cache behavior where applicable.
- [ ] Check the primary journey at phone and desktop widths. Before promoting any candidate,
      record the exact version, the rollback target or initial-launch recovery plan, and the
      public-domain smoke checks to run after promotion.

## Paste into the PR description

```markdown
**What changed:** <project identity, routes, and baseline behavior>

| Check                              | Command or URL                 | Result                               |
| ---------------------------------- | ------------------------------ | ------------------------------------ |
| Locked install                     | <command>                      | <passed / failed / not run + reason> |
| Source checks and production build | <commands>                     | <result>                             |
| Built output and browser smoke     | <pages, sizes, browser, build> | <result>                             |
| Hosted smoke                       | <candidate URL or unavailable> | <result>                             |

**Follow-ups:** <missing evidence, owner, and what must happen before launch>
```
