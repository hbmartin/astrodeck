# QA and release

Use a separate result for each kind of evidence:

| Check                               | Evidence                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Clean install and source validation | Locked dependencies, supported Node, lint/format/type checks and relevant unit tests                          |
| Real build                          | Required routes and metadata are in generated HTML; private drafts and template content are absent            |
| Browser journey                     | Actual interactions produce visible results; run affected behavior in Chromium, Firefox and WebKit            |
| Hosted response                     | The exact preview serves the intended status, redirect, body, response headers and representative asset types |
| Promotion                           | Accepted commit and deployment, rollback target, and public-domain smoke results                              |

For changes to navigation, test Tab and Shift+Tab, Escape, visible focus, short mobile screens,
200% text, resizing through the actual breakpoint, and jump destinations below any sticky header.
If outside dismissal is implemented, test that the target still activates and that scrolling or
selection does not dismiss the panel. Check touch changes on physical Safari or the target device;
Playwright WebKit covers an engine, not a hardware/browser combination. Start with the
[WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/).

Prove a regression test can fail for the intended reason. Wait for visible state instead of a
fixed delay; separate functional checks from timing claims. Keep traces only in approved artifact
storage: they can contain headers, URLs, or page data. Give any skipped check an explicit result
and reason. Require a reliable, affordable validation job before treating CI as a release gate.

Use the included HTTP smoke for public previews or local HTTP on loopback. For a protected preview,
use the host's authorized browser access on the exact candidate; verify that you reached your site,
not a login page. Keep credentials out of global headers, URLs, reports, and uploaded traces.
Before promotion, check real caching and asset responses, policy headers, and the primary journey.
Record the exact deployment and rollback IDs. Then smoke-test the public domain after promotion.

Add Lighthouse comparisons when you need to make a performance claim. Use the same runner,
browser version, profile, route, authentication and network behavior. Alternate several baseline
and candidate samples and retain raw results; a single lab score is diagnostic. Avoid copying a
custom audit browser or routing emulator until ordinary checks leave a specific gap.
