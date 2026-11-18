export const imageNameCases = [
  { name: 'noscript is inactive', body: '<button id="control"><img alt=""><noscript>Open menu</noscript></button>', named: false },
  { name: 'image reference text', body: '<span id="label">Open menu</span><button id="control"><img alt="" aria-labelledby="label"></button>', named: true },
  { name: 'image reference ARIA name', body: '<span id="label" role="img" aria-label="Open menu"></span><button id="control"><img alt="" aria-labelledby="label"></button>', named: true },
  { name: 'control reference ARIA name', body: '<span id="label" role="img" aria-label="Open menu"></span><button id="control" aria-labelledby="label"><img alt=""></button>', named: true },
  { name: 'empty reference permits ARIA fallback', body: '<span id="label"></span><button id="control" aria-labelledby="label" aria-label="Open menu"><img alt=""></button>', named: true },
  { name: 'empty reference permits image fallback', body: '<span id="label"></span><button id="control" aria-labelledby="label"><img alt="Open menu"></button>', named: true },
  { name: 'empty image alt suppresses title', body: '<button id="control"><img alt="" title="Open menu"></button>', named: false },
  { name: 'absent image alt permits title', body: '<button id="control"><img title="Open menu"></button>', named: true },
  { name: 'presentation image ignores alt', body: '<button id="control"><img role="presentation" alt="Open menu"></button>', named: false },
  { name: 'presentation image explicit ARIA name', body: '<button id="control"><img role="presentation" alt="" aria-label="Open menu"></button>', named: true },
  { name: 'presentation image explicit reference', body: '<span id="label">Open menu</span><button id="control"><img role="presentation" alt="" aria-labelledby="label"></button>', named: true },
  { name: 'empty ARIA label restores image semantics', body: '<button id="control"><img role="presentation" aria-label="" alt="Open menu"></button>', named: true },
  { name: 'description restores image semantics', body: '<span id="description">Description</span><button id="control"><img role="presentation" aria-describedby="description" alt="Open menu"></button>', named: true },
  { name: 'focusability restores image semantics', body: '<button id="control"><img role="presentation" tabindex="-1" alt="Open menu"></button>', named: true },
  { name: 'aria-hidden false does not restore presentation', body: '<button id="control"><img role="presentation" aria-hidden="false" alt="Open menu"></button>', named: false },
  { name: 'explicit native label', body: '<label for="control">Open menu</label><button id="control"><img alt=""></button>', named: true },
  { name: 'implicit native label', body: '<label>Open menu<button id="control"><img alt=""></button></label>', named: true },
  { name: 'empty native label suppresses content and title', body: '<label for="control"></label><button id="control" title="Open menu"><img alt="Open menu"></button>', named: false },
  { name: 'hidden native label suppresses content', body: '<label for="control" hidden>Open menu</label><button id="control"><img alt="Open menu"></button>', named: false },
  { name: 'aria-hidden native label suppresses content', body: '<label for="control" aria-hidden="true">Open menu</label><button id="control"><img alt="Open menu"></button>', named: false },
  { name: 'wrapping label excludes its button subtree', body: '<label><button id="control"><img alt="Open menu"></button></label>', named: false },
  { name: 'native label ARIA name', body: '<label for="control" aria-label="Open menu"></label><button id="control"><img alt=""></button>', named: true },
  { name: 'button ARIA name overrides empty native label', body: '<label for="control"></label><button id="control" aria-label="Open menu"><img alt=""></button>', named: true },
  { name: 'empty for disables implicit association', body: '<label for="">Not associated<button id="control"><img alt=""></button></label>', named: false },
  { name: 'missing for target disables implicit association', body: '<label for="missing">Not associated<button id="control"><img alt=""></button></label>', named: false },
  { name: 'first labelable descendant owns implicit label', body: '<label>Not this button<input><button id="control"><img alt=""></button></label>', named: false },
  { name: 'first duplicate ID is not labelable', body: '<span id="control">Other element</span><label for="control">Not associated</label><button id="control"><img alt=""></button>', named: false },
  { name: 'self reference uses ARIA fallback', body: '<button id="control" aria-labelledby="control" aria-label="Open menu"><img alt=""></button>', named: true },
  { name: 'self reference uses image fallback', body: '<button id="control" aria-labelledby="control"><img alt="Open menu"></button>', named: true },
  { name: 'reference targets do not chain', body: '<span id="first" aria-labelledby="second"></span><span id="second">Open menu</span><button id="control" aria-labelledby="first"><img alt=""></button>', named: false },
  { name: 'two empty references terminate', body: '<span id="first" aria-labelledby="second"></span><span id="second" aria-labelledby="first"></span><button id="control" aria-labelledby="first"><img alt=""></button>', named: false },
  { name: 'hidden ARIA reference retains hidden text', body: '<div hidden><span id="label"><span hidden>Open menu</span></span></div><button id="control" aria-labelledby="label"><img alt=""></button>', named: true },
  { name: 'referenced button ignores its empty native label', body: '<label for="source"></label><button id="source">Open</button><a id="control" href="/" aria-labelledby="source"><img alt=""></a>', named: true },
  { name: 'referenced button ignores its hidden native label', body: '<label for="source" hidden>Hidden label</label><button id="source">Open</button><a id="control" href="/" aria-labelledby="source"><img alt=""></a>', named: true },
  { name: 'descendant button ignores its empty native label', body: '<label for="source"></label><a id="control" href="/"><img alt=""><button id="source">Open</button></a>', named: true },
  { name: 'descendant div title does not name its link', body: '<a id="control" href="/"><img alt=""><div title="Open"></div></a>', named: false },
  { name: 'descendant span title does not name its button', body: '<button id="control"><img alt=""><span title="Open"></span></button>', named: false },
  { name: 'descendant i title does not name its link', body: '<a id="control" href="/"><i title="Open"><img alt=""></i></a>', named: false },
  { name: 'direct reference permits title fallback', body: '<span id="source" title="Open"></span><button id="control" aria-labelledby="source"><img alt=""></button>', named: true },
  { name: 'descendant section permits title fallback', body: '<button id="control"><img alt=""><section title="Open"></section></button>', named: true },
  { name: 'child ARIA name remains effective', body: '<button id="control"><img alt=""><span aria-label="Open"></span></button>', named: true },
  { name: 'hidden input cannot name an ancestor', body: '<button id="control"><img alt=""><input type="hidden" aria-label="Open" value="Open"></button>', named: false },
  { name: 'hidden input value cannot name a reference', body: '<input id="source" type="hidden" value="Open"><button id="control" aria-labelledby="source"><img alt=""></button>', named: false },
  { name: 'direct hidden input reference permits ARIA name', body: '<input id="source" type="hidden" aria-label="Open"><button id="control" aria-labelledby="source"><img alt=""></button>', named: true },
  { name: 'direct hidden input reference permits title', body: '<input id="source" type="hidden" title="Open"><button id="control" aria-labelledby="source"><img alt=""></button>', named: true },
  { name: 'first presentation role wins', body: '<button id="control"><img role="none presentation" alt="Open"></button>', named: false },
  { name: 'unknown role permits presentation fallback', body: '<button id="control"><img role="unknown presentation" alt="Open"></button>', named: false },
  { name: 'recognized image role wins before presentation', body: '<button id="control"><img role="img presentation" alt="Open"></button>', named: true },
  { name: 'abstract role permits presentation fallback', body: '<button id="control"><img role="widget presentation" alt="Open"></button>', named: false },
  { name: 'ASCII whitespace separates fallback roles', body: '<button id="control"><img role="unknown\t\n\f\r presentation" alt="Open"></button>', named: false },
  { name: 'non-ASCII whitespace does not separate fallback roles', body: '<button id="control"><img role="unknown\u00a0presentation" alt="Open"></button>', named: true },
];

// These are intentionally separate from parity cases: CSS changes the browser name, while
// the HTML-only checker must decline to report a certain missing-name finding in every case.
const untilFoundDisplays = [
  { name: 'inline default', tag: 'span', display: 'inline' },
  { name: 'block default', tag: 'div', display: 'block' },
  { name: 'block with inline override', tag: 'div', display: 'inline', override: true },
  { name: 'inline with block override', tag: 'span', display: 'block', override: true },
];

export const untilFoundNameCases = untilFoundDisplays.flatMap((fixture) => {
  const opening = `<${fixture.tag} id="source" hidden="until-found"${fixture.override ? ` style="display:${fixture.display}"` : ''}>`;
  const closing = `</${fixture.tag}>`;
  return [
    {
      ...fixture,
      name: `${fixture.name} name source`,
      named: fixture.display === 'inline',
      ignored: false,
      body: `<button id="control"><img alt="">${opening}Open${closing}</button>`,
    },
    {
      ...fixture,
      name: `${fixture.name} control ancestor`,
      named: false,
      ignored: fixture.display === 'block',
      body: `${opening}<button id="control"><img alt=""></button>${closing}`,
    },
  ];
});
