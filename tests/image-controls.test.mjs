import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../scripts/lib/html-tree.mjs';
import { checkImageControls } from '../scripts/lib/image-links.mjs';

function findings(markup) {
  const result = [];
  checkImageControls(parseDocument(markup), (rule, message) => result.push({ rule, message }));
  return result;
}

const LINK_ERROR = [
  { rule: 'image-link-name', message: 'Image link to "/" has no accessible name' },
];
const BUTTON_ERROR = [
  { rule: 'image-button-name', message: 'Image button has no accessible name' },
];

test('unnamed native image links and buttons fail, while decorative standalone images pass', () => {
  assert.deepEqual(findings('<a href="/"><img alt=""></a>'), LINK_ERROR);
  assert.deepEqual(findings('<button><img alt=""></button>'), BUTTON_ERROR);
  assert.deepEqual(findings('<img alt=""><button>Text button</button>'), []);
  assert.deepEqual(
    findings('<a><img alt=""></a><div role="button"><img alt=""></div><input type="image" alt="">'),
    []
  );
});

test('hidden ancestors suppress image-control naming checks without child overrides', () => {
  for (const hidden of ['hidden', 'aria-hidden="true"']) {
    assert.deepEqual(
      findings(
        `<div ${hidden}><a href="/" aria-hidden="false"><img alt=""></a><button><img alt=""></button></div>`
      ),
      []
    );
  }
  assert.deepEqual(findings('<button hidden><img alt=""></button>'), []);
  assert.deepEqual(findings('<a href="/"><img hidden alt="Invisible name"></a>'), LINK_ERROR);
});

test('ordinary semantic wrappers do not hide unnamed images from the rule', () => {
  for (const wrapper of ['figure', 'strong', 'em', 'section']) {
    assert.deepEqual(findings(`<a href="/"><${wrapper}><img alt=""></${wrapper}></a>`), LINK_ERROR);
    assert.deepEqual(
      findings(`<button><${wrapper}><img alt=""></${wrapper}></button>`),
      BUTTON_ERROR
    );
  }
  assert.deepEqual(
    findings(
      '<a href="/"><figure><img alt=""><figcaption>Read the report</figcaption></figure></a>'
    ),
    []
  );
  assert.deepEqual(findings('<button><strong><img alt="Open menu"></strong></button>'), []);
});

test('explicit naming and visible text name image controls', () => {
  for (const name of ['aria-label="Open menu"', 'title="Open menu"']) {
    assert.deepEqual(findings(`<button ${name}><img alt=""></button>`), []);
  }
  assert.deepEqual(findings('<a href="/"><img alt="">Read the report</a>'), []);
  assert.deepEqual(findings('<button><img alt="Open &amp; close"></button>'), []);
  assert.deepEqual(
    findings('<button><img role="presentation" alt="Ignored"></button>'),
    BUTTON_ERROR
  );
  assert.deepEqual(findings('<button><img alt="   "></button>'), BUTTON_ERROR);
});

test('label references include hidden descendant text when hidden by an ancestor', () => {
  assert.deepEqual(
    findings(
      '<div hidden><span id="label"><span hidden>Open menu</span></span></div><button aria-labelledby="label"><img alt=""></button>'
    ),
    []
  );
  assert.deepEqual(
    findings(
      '<div aria-hidden="true"><span id="label"><span aria-hidden="true">Open menu</span></span></div><a href="/" aria-labelledby="label"><img alt=""></a>'
    ),
    []
  );
  assert.deepEqual(
    findings(
      '<span id="label"><span hidden>Hidden name</span></span><button aria-labelledby="label"><img alt=""></button>'
    ),
    BUTTON_ERROR
  );
});

test('label-reference precedence distinguishes missing targets from valid empty targets', () => {
  assert.deepEqual(
    findings('<button aria-labelledby="missing" aria-label="Open menu"><img alt=""></button>'),
    []
  );
  assert.deepEqual(
    findings(
      '<span id="empty"></span><button aria-labelledby="empty" aria-label="Ignored fallback"><img alt=""></button>'
    ),
    BUTTON_ERROR
  );
  assert.deepEqual(
    findings(
      '<span id="label">Open menu</span><button aria-labelledby="missing label"><img alt=""></button>'
    ),
    []
  );
});

test('unsupported embedded widgets remain unknown unless explicit naming establishes an empty name', () => {
  for (const widget of [
    '<svg role="img"><title>Icon</title></svg>',
    '<custom-control></custom-control>',
    '<canvas></canvas>',
  ]) {
    assert.deepEqual(findings(`<button><img alt="">${widget}</button>`), []);
    assert.deepEqual(
      findings(
        `<span id="empty"></span><button aria-labelledby="empty"><img alt="">${widget}</button>`
      ),
      BUTTON_ERROR
    );
  }
  assert.deepEqual(
    findings('<button><img alt=""><custom-control hidden></custom-control></button>'),
    BUTTON_ERROR
  );
});

test('script and template content cannot name active controls or create image controls', () => {
  assert.deepEqual(
    findings(
      '<button><img alt=""><script>"Not a label"</script><template>Not a label</template></button>'
    ),
    BUTTON_ERROR
  );
  assert.deepEqual(
    findings(
      '<template><button><img alt=""></button></template><a href="/"><template><img alt=""></template></a>'
    ),
    []
  );
});
