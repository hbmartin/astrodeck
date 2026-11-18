import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, findFirstElement, elementName } from '../scripts/lib/html-tree.mjs';
import { checkImageControls } from '../scripts/lib/image-links.mjs';
import { imageNameCases, untilFoundNameCases } from './fixtures/image-name-cases.mjs';

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
      '<span id="empty"></span><button aria-labelledby="empty" aria-label="Actual fallback"><img alt=""></button>'
    ),
    []
  );
  assert.deepEqual(
    findings(
      '<span id="label">Open menu</span><button aria-labelledby="missing label"><img alt=""></button>'
    ),
    []
  );
});

test('unsupported embedded widgets remain unknown after empty reference fallback', () => {
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
      []
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

test('unsupported native control values remain uncertain when used as name sources', () => {
  for (const source of [
    '<input id="label" value="Open menu">',
    '<textarea id="label">Open menu</textarea>',
    '<select id="label"><option selected></option><option>Other</option></select>',
    '<meter id="label" value="0.5">Fallback</meter>',
    '<progress id="label" value="0.5">Fallback</progress>',
  ]) {
    assert.deepEqual(
      findings(`${source}<button aria-labelledby="label"><img alt=""></button>`),
      [],
      source
    );
  }
  assert.deepEqual(findings('<button><img alt=""><input value="Open menu"></button>'), []);
});

test('supported native image-control names match the browser oracle fixtures', () => {
  for (const fixture of imageNameCases) {
    const expected = fixture.body.includes('<a id="control"') ? LINK_ERROR : BUTTON_ERROR;
    assert.deepEqual(findings(fixture.body), fixture.named ? [] : expected, fixture.name);
  }
});

test('documents without native image controls do not construct a name context', () => {
  const root = parseDocument('<div></div><button>Text only</button><img alt="">');
  const unrelated = findFirstElement(root, (node) => elementName(node) === 'div');
  Object.defineProperty(unrelated, 'attrs', {
    get() {
      return assert.fail(
        'name context should be lazy for documents without relevant image controls'
      );
    },
  });
  checkImageControls(root, () => assert.fail('no native image control exists'));
});

test('until-found visibility remains uncertain regardless of inline or block CSS', () => {
  for (const fixture of untilFoundNameCases)
    assert.deepEqual(findings(fixture.body), [], fixture.name);
  assert.deepEqual(
    findings('<button><img alt=""><div hidden="until-found">Uncertain</div>Known name</button>'),
    []
  );
  assert.deepEqual(
    findings(
      '<button><img alt=""><div hidden><span hidden="until-found">Hidden</span></div></button>'
    ),
    BUTTON_ERROR
  );
});

test('deeply nested names use all 5000 levels without recursion or truncation', () => {
  const open = '<span>'.repeat(5000);
  const close = '</span>'.repeat(5000);
  for (const [content, expected] of [
    ['<img alt="">', BUTTON_ERROR],
    ['<img alt="Open menu">', []],
    ['<img alt=""><custom-widget></custom-widget>', []],
  ])
    assert.deepEqual(findings(`<button>${open}${content}${close}</button>`), expected);
  assert.deepEqual(
    findings(
      `<span id="label">${open}Open menu${close}</span><button aria-labelledby="label"><img alt=""></button>`
    ),
    []
  );
});

test('complex native-label reference cycles stay uncertain instead of becoming false findings', () => {
  for (const alt of ['Open menu', ''])
    assert.deepEqual(
      findings(
        `<label for="control" aria-labelledby="control"></label><button id="control"><img alt="${alt}"></button>`
      ),
      []
    );
});
