# What to port from a mature AstroDeck site

The reusable boundary is usually a small policy, test, or helper. Copy code when its inputs and
outputs match the new project. Otherwise start from the design and verify the new behavior first.

| Area                      | Start with                                                                                         | Bring over later if needed                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout and navigation     | AstroDeck layouts, semantic tokens, native links and buttons, an accessible disclosure             | Measured sticky offsets and focused regressions. The full Cedar header handles nested disclosures, selection, and WebKit quirks; port isolated behavior only when it reproduces.                                           |
| Content and SEO           | Site identity, explicit visibility, typed metadata, and checks on the generated HTML               | Collections for repeating records, a content repository if it simplifies access, generated route expectations, explicit sitemap filtering and entity graphs. Do not import unrelated content schemas or legal claims.      |
| Brand and images          | Canonical artwork, a small set of licensed assets, bounded widths and intrinsic dimensions         | Deterministic icon and social-card generators, a media manifest, provider-specific image delivery and real response checks. Compare artifact size and build time before picking an optimizer.                              |
| Scheduling, payments, CRM | A link and a working contact fallback, with the supplied helper if the destination is configurable | Separate provider interfaces once you have more than one behavior. Keep test and production accounts separate. Treat absent optional config as a fallback and invalid explicit config as an operator error.                |
| Analytics                 | No tracking by default; choose a few outcomes and an approved payload                              | Typed events, an allowlist and end-to-end payload verification. Consider an in-memory startup buffer only if lost early events matter. Leave Cedar's vendor, event inventory, scripts, and identifiers behind.             |
| Deployment                | A static build, basic HTTP checks, the intended host and an early preview                          | The adapter, routing rules, policy emission, and image optimization for that host. Verify strict CSP against final assets and ordinary browser actions if adopted. Do not port a provider's output format to another host. |
| QA and audits             | Locked install, production build, metadata checks, a focused browser journey and hosted smoke      | Cross-browser regression cases, isolated built fixtures and measured performance comparisons as requirements justify them. Keep the custom routing emulator and audit browser out of the baseline.                         |

## Example: hosted provider with a fallback

Set an optional `hostedHeaderCta` on the central site configuration:

```ts
hostedHeaderCta: {
  label: 'Book a call',
  allowedOrigins: ['https://booking.example'],
  fallback: { href: '/contact/', label: 'Contact us' },
},
```

Use a fallback route that exists in your site. Set `HOSTED_CTA_URL` to the actual approved
booking page in the build environment. Leave it unset to use the fallback. An invalid explicit
value fails the build with the setting name but without the URL. Leave the option off to keep
the normal header CTA. The URL is rendered as a public link: keep secrets and user attributes
out of it. An origin check does not make every route on an origin appropriate; add a path
constraint where the provider hosts unrelated services or redirectors.

For analytics, don't read form field values or send arbitrary query strings, text labels, or
visitor identifiers. Check exactly what the receiving test collector observes. Use the
[QA guide](STARTER-QA.md) to keep that evidence separate from a real traffic or performance claim.

## Reference implementations

The technical kit runs independently of Cedar. If you have access and need the more elaborate
implementations, start with [the Cedar engineering guides](https://github.com/hbmartin/cedar-site/pull/56),
[the native click fix](https://github.com/hbmartin/cedar-site/pull/49),
[the deployed asset and lazy-module regression](https://github.com/hbmartin/cedar-site/pull/51),
and [the integration and fixture follow-ups](https://github.com/hbmartin/cedar-site/pull/52).
