import { test, expect } from '@playwright/test';
import { parseDocument } from '../../scripts/lib/html-tree.mjs';
import { checkImageControls } from '../../scripts/lib/image-links.mjs';
import { imageNameCases, untilFoundNameCases } from '../fixtures/image-name-cases.mjs';

function staticFindings(body) {
  const findings = [];
  checkImageControls(parseDocument(body), (rule) => findings.push(rule));
  return findings;
}

async function browserControl(page, body) {
  await page.setContent(body);
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument');
    // Select the actual control, including when an earlier non-control has the same ID.
    const { nodeIds } = await session.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'button:has(img), a[href]:has(img)',
    });
    expect(nodeIds).toHaveLength(1);
    const { node } = await session.send('DOM.describeNode', { nodeId: nodeIds[0] });
    const { nodes } = await session.send('Accessibility.getPartialAXTree', {
      backendNodeId: node.backendNodeId,
      fetchRelatives: false,
    });
    // AX tree order and role names cannot identify duplicate-ID controls reliably.
    const control = nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId);
    expect(control).toBeDefined();
    return {
      named: Boolean(control.name?.value.trim()),
      ignored: control.ignored,
      rule: node.nodeName === 'A' ? 'image-link-name' : 'image-button-name',
    };
  } finally {
    await session.detach();
  }
}

test.describe('deterministic image-control names agree with Chromium', () => {
  for (const fixture of imageNameCases) {
    test(fixture.name, async ({ page }) => {
      const control = await browserControl(page, fixture.body);
      expect(control.named).toBe(fixture.named);
      expect(control.ignored).toBe(false);
      expect(staticFindings(fixture.body)).toEqual(control.named ? [] : [control.rule]);
    });
  }
});

test.describe('until-found browser state and conservative HTML checking', () => {
  for (const fixture of untilFoundNameCases) {
    test(fixture.name, async ({ page }) => {
      const control = await browserControl(page, fixture.body);
      expect(control.named).toBe(fixture.named);
      expect(control.ignored).toBe(fixture.ignored);
      const state = await page.locator('#source').evaluate((element) => ({
        hidden: element.getAttribute('hidden'),
        display: element.ownerDocument.defaultView.getComputedStyle(element).display,
        contentVisibility:
          element.ownerDocument.defaultView.getComputedStyle(element).contentVisibility,
      }));
      expect(state).toEqual({
        hidden: 'until-found',
        display: fixture.display,
        contentVisibility: 'hidden',
      });
      expect(staticFindings(fixture.body)).toEqual([]);
    });
  }
});
