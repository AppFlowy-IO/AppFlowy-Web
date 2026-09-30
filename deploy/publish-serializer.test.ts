/** @jest-environment node */

import {
  publishedDatabasePayload,
  publishedDocumentPayload,
  publishedRichDocumentPayload,
  richDocumentChildViewId,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { BlockType } from '@/application/types';

import {
  collectLinkedViewIds,
  DESCRIPTION_MAX_LENGTH,
  escapeHtml,
  extractPageDescription,
  sanitizeUrl,
  SERIALIZER_BLOCK_COVERAGE,
  serializePublishedPage,
} from './publish-serializer';

const serialize = (snapshot: unknown) => {
  const result = serializePublishedPage(snapshot);

  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);

  return result.html;
};

const leaf = (text: string, marks: Record<string, unknown> = {}) => ({ text, ...marks });
const textEl = (...leaves: object[]) => ({ type: 'text', textId: 't', children: leaves });
const blk = (type: string, leaves: object[] | null, data: object = {}, children: object[] = []) => ({
  type,
  blockId: 'b',
  data,
  children: [...(leaves ? [textEl(...leaves)] : []), ...children],
});

const doc = (children: unknown[], name = 'Title', extraView: object = {}) => ({
  schemaVersion: 1,
  kind: 'document',
  namespace: 'ns',
  publishName: 'page',
  view: { viewId: 'v', name, icon: null, extra: null, layout: 0, ...extraView },
  document: { children },
});

const body = (children: unknown[]) => serialize(doc(children, '')).replace(/^<article data-appflowy-ssr>|<\/article>$/g, '');

describe('serializePublishedPage', () => {
  describe('fixtures', () => {
    it('renders the basic document fixture', () => {
      expect(serialize(publishedDocumentPayload)).toBe(
        '<article data-appflowy-ssr><h1>Published document</h1><p>Published document body</p></article>'
      );
    });

    it('renders every block family in the rich fixture', () => {
      const html = serialize(publishedRichDocumentPayload);

      expect(html).toContain('<h1>Rich document</h1>');
      expect(html).toContain('<h2>Introduction</h2>');
      expect(html).toContain('<strong><em>bold italic</em></strong>');
      expect(html).toContain('<a href="https://appflowy.com">a link</a>');
      expect(html).toContain('<ul><li>First bullet<ul><li>Nested bullet</li></ul></li><li>Second bullet</li></ul>');
      expect(html).toContain('<ol start="3"><li>Step one</li><li>Step two</li></ol>');
      expect(html).toContain('<li><input type="checkbox" disabled checked> Done task</li>');
      expect(html).toContain('<details open><summary>Toggle title</summary><p>Hidden detail</p></details>');
      expect(html).toContain('<blockquote><p>A quotation</p></blockquote>');
      expect(html).toContain('<aside><span>💡</span> <p>Callout body</p></aside>');
      expect(html).toContain('<pre><code class="language-typescript">const a = 1 &lt; 2;</code></pre>');
      expect(html).toContain('<pre>E = mc^2</pre>');
      expect(html).toContain('<hr>');
      expect(html).toContain('<figure><img src="https://example.com/image.png" alt=""></figure>');
      expect(html).toContain('<p><a href="https://example.com/report.pdf">Report</a></p>');
      expect(html).toContain('<table><tbody><tr><td><p>Cell A1</p></td><td><p>Cell B1</p></td></tr></tbody></table>');
      expect(html).toContain('<div><div><p>Left column</p></div><div><p>Right column</p></div></div>');
      expect(html).toContain('<p>Child page</p>');
      expect(html).toContain(
        '<p>See <span>Child page</span> on <time datetime="2026-09-30">2026-09-30</time> with <span>Ada</span>.</p>'
      );
      // Mention placeholders never leak into the output.
      expect(html).not.toContain('$');
    });

    it('refuses the database fixture so the route serves the shell', () => {
      expect(serializePublishedPage(publishedDatabasePayload)).toEqual({ ok: false, reason: 'unsupported_kind' });
    });
  });

  describe('blocks', () => {
    it.each([
      [1, 'h2'],
      [2, 'h3'],
      [3, 'h4'],
      [5, 'h6'],
      [6, 'h6'],
      [99, 'h6'],
      [undefined, 'h2'],
    ])('shifts heading level %p down to <%s>', (level, tag) => {
      expect(body([blk('heading', [leaf('H')], { level })])).toBe(`<${tag}>H</${tag}>`);
    });

    it('omits the <h1> when the page has no name', () => {
      expect(serialize(doc([], ''))).toBe('<article data-appflowy-ssr></article>');
    });

    it('renders an empty document as the title only', () => {
      expect(serialize(doc([]))).toBe('<article data-appflowy-ssr><h1>Title</h1></article>');
    });

    it('treats a missing document as a failure', () => {
      expect(serializePublishedPage({ ...doc([]), document: undefined })).toEqual({
        ok: false,
        reason: 'missing_document',
      });
    });

    it('starts a new list when the list type changes', () => {
      expect(
        body([
          blk('bulleted_list', [leaf('a')]),
          blk('numbered_list', [leaf('b')]),
          blk('bulleted_list', [leaf('c')]),
        ])
      ).toBe('<ul><li>a</li></ul><ol><li>b</li></ol><ul><li>c</li></ul>');
    });

    it('starts a new list when a non-list block interrupts', () => {
      expect(body([blk('bulleted_list', [leaf('a')]), blk('paragraph', [leaf('p')]), blk('bulleted_list', [leaf('b')])])).toBe(
        '<ul><li>a</li></ul><p>p</p><ul><li>b</li></ul>'
      );
    });

    it('nests child blocks under a paragraph', () => {
      expect(body([blk('paragraph', [leaf('parent')], {}, [blk('paragraph', [leaf('child')])])])).toBe(
        '<p>parent</p><p>child</p>'
      );
    });

    it('drops an unsafe code language class but keeps the code', () => {
      expect(body([blk('code', [leaf('x')], { language: '"><script>' })])).toBe('<pre><code>x</code></pre>');
    });

    it('renders a legacy table from cell positions', () => {
      const cell = (row: number, col: number, value: string) =>
        blk('table/cell', null, { rowPosition: row, colPosition: col }, [blk('paragraph', [leaf(value)])]);

      expect(body([blk('table', null, {}, [cell(1, 0, 'c'), cell(0, 1, 'b'), cell(0, 0, 'a')])])).toBe(
        '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td></tr></tbody></table>'
      );
    });

    it('renders multi-image galleries and skips unsafe images', () => {
      expect(
        body([blk('multi_image', null, { images: [{ url: 'https://x/1.png' }, { url: 'javascript:alert(1)' }] })])
      ).toBe('<figure><img src="https://x/1.png" alt=""></figure>');
    });

    it('renders embedded database blocks as nothing', () => {
      expect(body([blk('grid', null, { view_id: 'x' })])).toBe('');
    });

    it('skips the outline block, whose headings are already rendered', () => {
      expect(body([blk('outline', null)])).toBe('');
    });

    it('skips an icon-library callout icon', () => {
      expect(body([blk('callout', [leaf('c')], { icon: '{"iconContent":"<svg/>"}', icon_type: 'icon' })])).toBe(
        '<aside><p>c</p></aside>'
      );
    });

    it('renders soft line breaks', () => {
      expect(body([blk('paragraph', [leaf('a\nb')])])).toBe('<p>a<br>b</p>');
    });
  });

  describe('unknown and malformed content', () => {
    it('keeps the text and children of an unknown block type', () => {
      expect(body([blk('future_block', [leaf('kept text')], {}, [blk('paragraph', [leaf('kept child')])])])).toBe(
        '<div data-block-type="future_block"><p>kept text</p><p>kept child</p></div>'
      );
    });

    it('escapes an unknown block type name', () => {
      expect(body([blk('x"><script>', [leaf('t')])])).toBe(
        '<div data-block-type="x&quot;&gt;&lt;script&gt;"><p>t</p></div>'
      );
    });

    it('skips malformed sibling nodes and keeps the rest', () => {
      expect(body([null, 42, 'str', { noType: true }, blk('paragraph', [leaf('ok')])])).toBe('<p>ok</p>');
    });

    it('ignores malformed leaves', () => {
      expect(body([blk('paragraph', [null, 7, { text: 5 }, leaf('ok')])])).toBe('<p>ok</p>');
    });

    it.each([
      [null, 'not_an_object'],
      ['string', 'not_an_object'],
      [[], 'not_an_object'],
      [{ ...doc([]), schemaVersion: 2 }, 'unsupported_schema_version'],
      [{ ...doc([]), kind: 'whiteboard' }, 'unsupported_kind'],
      [{ ...doc([]), document: { children: 'nope' } }, 'missing_document'],
    ])('rejects %p with %s', (input, reason) => {
      expect(serializePublishedPage(input)).toEqual({ ok: false, reason });
    });

    it('fails safely on pathologically deep nesting', () => {
      let node = blk('paragraph', [leaf('deep')]);

      for (let i = 0; i < 200; i += 1) node = blk('paragraph', null, {}, [node]);

      expect(serializePublishedPage(doc([node]))).toEqual({ ok: false, reason: 'too_deep' });
    });
  });

  describe('inline content', () => {
    it.each([
      [{ bold: true }, '<strong>t</strong>'],
      [{ italic: true }, '<em>t</em>'],
      [{ underline: true }, '<u>t</u>'],
      [{ strikethrough: true }, '<s>t</s>'],
      [{ code: true }, '<code>t</code>'],
      [
        { bold: true, italic: true, underline: true, strikethrough: true, code: true, href: 'https://a.b' },
        '<a href="https://a.b"><strong><em><u><s><code>t</code></s></u></em></strong></a>',
      ],
      [{ bold: 'yes' }, 't'],
      [{ font_color: 'red', bg_color: 'blue' }, 't'],
    ])('renders marks %p', (marks, expected) => {
      expect(body([blk('paragraph', [leaf('t', marks)])])).toBe(`<p>${expected}</p>`);
    });

    it('renders an inline formula from its formula, not its placeholder', () => {
      expect(body([blk('paragraph', [leaf('$', { formula: 'x^2' })])])).toBe('<p><span>x^2</span></p>');
    });

    it.each([
      [{ type: 'externalLink', url: 'https://ext.example' }, '<a href="https://ext.example">https://ext.example</a>'],
      [{ type: 'externalLink', url: 'javascript:alert(1)' }, ''],
      [{ type: 'date', date: '1759226400000' }, '<time datetime="2025-09-30">2025-09-30</time>'],
      [{ type: 'date', date: 'not a date' }, ''],
      [{ type: 'person', person_id: 'p' }, ''],
      [{ type: 'page', page_id: 'unknown-view' }, ''],
      [{ type: 'page', page_id: 'row', row_id: 'r', data: { title: 'Row title' } }, '<span>Row title</span>'],
      [{ type: 'mystery' }, ''],
    ])('renders mention %p', (mention, expected) => {
      expect(body([blk('paragraph', [leaf('$', { mention })])])).toBe(expected ? `<p>${expected}</p>` : '');
    });

    it('resolves page mentions against ancestor views', () => {
      const html = serialize(
        doc([blk('paragraph', [leaf('$', { mention: { type: 'page', page_id: 'anc' } })])], 'T', {
          ancestorViews: [{ view_id: 'anc', name: 'Ancestor' }],
        })
      );

      expect(html).toContain('<p><span>Ancestor</span></p>');
    });
  });

  describe('injection', () => {
    it('escapes a <script> in the page title', () => {
      const html = serialize(doc([], '<script>alert(1)</script>'));

      expect(html).toBe('<article data-appflowy-ssr><h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1></article>');
    });

    it('escapes HTML in paragraph text', () => {
      expect(body([blk('paragraph', [leaf('<img src=x onerror=alert(1)>')])])).toBe(
        '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
      );
    });

    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '&#x6a;avascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ])('drops the link but keeps the text for href %p', (href) => {
      expect(body([blk('paragraph', [leaf('click', { href })])])).toBe('<p>click</p>');
    });

    it('escapes quote-breaking attribute values', () => {
      expect(body([blk('paragraph', [leaf('x', { href: 'https://a.b/" onmouseover="alert(1)' })])])).toBe(
        '<p><a href="https://a.b/&quot; onmouseover=&quot;alert(1)">x</a></p>'
      );
      expect(body([blk('image', null, { url: "https://a.b/'><script>" })])).toBe(
        '<figure><img src="https://a.b/&#39;&gt;&lt;script&gt;" alt=""></figure>'
      );
    });

    it('escapes mention names and file names', () => {
      expect(body([blk('paragraph', [leaf('$', { mention: { type: 'person', person_id: 'p', person_name: '<b>x</b>' } })])])).toBe(
        '<p><span>&lt;b&gt;x&lt;/b&gt;</span></p>'
      );
      expect(body([blk('file', null, { url: 'https://f', name: '"><script>' })])).toBe(
        '<p><a href="https://f">&quot;&gt;&lt;script&gt;</a></p>'
      );
    });
  });
});

describe('links to other published pages', () => {
  const childId = richDocumentChildViewId;
  const withChild = (children: unknown[]) =>
    doc(children, '', { childViews: [{ view_id: childId, name: 'Child page' }] });
  const pageMention = (mention: object) => blk('paragraph', [leaf('$', { mention })]);
  const render = (children: unknown[], viewHrefs: Map<string, string>) => {
    const result = serializePublishedPage(withChild(children), { viewHrefs });

    if (!result.ok) throw new Error(result.reason);

    return result.html.replace(/^<article data-appflowy-ssr>|<\/article>$/g, '');
  };

  const hrefs = new Map([[childId, '/docs/child-page']]);

  it('links sub-page blocks and page mentions when their URL resolved', () => {
    expect(render([blk('sub_page', null, { view_id: childId })], hrefs)).toBe(
      '<p><a href="/docs/child-page">Child page</a></p>'
    );
    expect(render([pageMention({ type: 'page', page_id: childId })], hrefs)).toBe(
      '<p><a href="/docs/child-page">Child page</a></p>'
    );
    expect(render([pageMention({ type: 'childPage', page_id: childId })], hrefs)).toBe(
      '<p><a href="/docs/child-page">Child page</a></p>'
    );
  });

  it('renders plain names when a URL did not resolve', () => {
    expect(render([blk('sub_page', null, { view_id: childId })], new Map())).toBe('<p>Child page</p>');
    expect(render([pageMention({ type: 'page', page_id: childId })], new Map())).toBe(
      '<p><span>Child page</span></p>'
    );
  });

  it('does not link database-row mentions', () => {
    expect(render([pageMention({ type: 'page', page_id: childId, row_id: 'r1' })], hrefs)).toBe(
      '<p><span>Child page</span></p>'
    );
  });

  it('still sanitizes and escapes resolved URLs', () => {
    expect(render([blk('sub_page', null, { view_id: childId })], new Map([[childId, 'javascript:alert(1)']]))).toBe(
      '<p>Child page</p>'
    );
    expect(render([blk('sub_page', null, { view_id: childId })], new Map([[childId, '/a"b']]))).toBe(
      '<p><a href="/a&quot;b">Child page</a></p>'
    );
  });
});

describe('collectLinkedViewIds', () => {
  it('lists the rich fixture sub-page and page mention once', () => {
    expect(collectLinkedViewIds(publishedRichDocumentPayload)).toEqual([richDocumentChildViewId]);
  });

  it('finds targets in nested blocks, in document order', () => {
    const snapshot = doc(
      [
        blk('toggle_list', [leaf('t')], {}, [
          blk('paragraph', [leaf('$', { mention: { type: 'page', page_id: 'b' } })]),
        ]),
        blk('sub_page', null, { view_id: 'a' }),
        blk('linked_page', null, { view_id: 'c' }),
      ],
      'T',
      { childViews: [{ view_id: 'a', name: 'A' }, { view_id: 'b', name: 'B' }, { view_id: 'c', name: 'C' }] }
    );

    expect(collectLinkedViewIds(snapshot)).toEqual(['b', 'a', 'c']);
  });

  it('skips targets with no name, database mentions and non-page mentions', () => {
    const snapshot = doc(
      [
        blk('sub_page', null, { view_id: 'unnamed' }),
        blk('paragraph', [
          leaf('$', { mention: { type: 'page', page_id: 'a', database_row_id: 'r' } }),
          leaf('$', { mention: { type: 'person', person_id: 'a' } }),
        ]),
      ],
      'T',
      { childViews: [{ view_id: 'a', name: 'A' }] }
    );

    expect(collectLinkedViewIds(snapshot)).toEqual([]);
  });

  it.each([null, 'x', publishedDatabasePayload, { kind: 'document' }])('returns [] for %p', (input) => {
    expect(collectLinkedViewIds(input)).toEqual([]);
  });
});

describe('sanitizeUrl', () => {
  it.each([
    ['https://a.b/c', 'https://a.b/c'],
    ['HTTP://a.b', 'HTTP://a.b'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['/docs/page', '/docs/page'],
    ['#anchor', '#anchor'],
    ['  https://trim.me  ', 'https://trim.me'],
    ['example.com', null],
    ['', null],
    [42, null],
    [undefined, null],
  ])('%p → %p', (input, expected) => {
    expect(sanitizeUrl(input)).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes all five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('block type coverage', () => {
  // Fails when a BlockType is added to the editor without deciding how the
  // server-side serializer should treat it. Add it to `handled` (with markup)
  // or to `textFallback` (the neutral wrapper that keeps its text) in
  // deploy/publish-serializer.ts.
  it('accounts for every BlockType', () => {
    const known = new Set([...SERIALIZER_BLOCK_COVERAGE.handled, ...SERIALIZER_BLOCK_COVERAGE.textFallback]);
    const missing = Object.values(BlockType).filter((type) => !known.has(type));

    expect(missing).toEqual([]);
  });

  it('lists no block types that do not exist', () => {
    const blockTypes = new Set<string>(Object.values(BlockType));
    const stale = [...SERIALIZER_BLOCK_COVERAGE.handled, ...SERIALIZER_BLOCK_COVERAGE.textFallback].filter(
      (type) => !blockTypes.has(type)
    );

    expect(stale).toEqual([]);
  });
});

describe('page mentions with a denormalized title', () => {
  // Shapes taken from the published "Getting Started With AppFlowy" guide page.
  const titledPageMention = { type: 'page', page_id: 'outside-tree', data: { title: 'Space-level permissions' } };
  const databaseReference = { type: 'page', page_id: 'db-view', database_id: 'db', data: { title: 'Tasks' } };
  const snapshot = (mention: object) => doc([blk('paragraph', [leaf('$', { mention })])], '');

  it('uses the title when the page is outside the view tree, and links it', () => {
    const result = serializePublishedPage(snapshot(titledPageMention), {
      viewHrefs: new Map([['outside-tree', '/guide/space-level-permissions']]),
    });

    expect(result).toEqual({
      ok: true,
      html: '<article data-appflowy-ssr><p><a href="/guide/space-level-permissions">Space-level permissions</a></p></article>',
    });
    expect(collectLinkedViewIds(snapshot(titledPageMention))).toEqual(['outside-tree']);
  });

  it('renders a database reference by title without linking it', () => {
    const result = serializePublishedPage(snapshot(databaseReference), {
      viewHrefs: new Map([['db-view', '/docs/tasks']]),
    });

    expect(result).toEqual({ ok: true, html: '<article data-appflowy-ssr><p><span>Tasks</span></p></article>' });
    expect(collectLinkedViewIds(snapshot(databaseReference))).toEqual([]);
  });

  it('renders nothing for a page mention with neither a known name nor a title', () => {
    expect(serialize(snapshot({ type: 'page', page_id: 'unknown' }))).toBe('<article data-appflowy-ssr></article>');
    expect(collectLinkedViewIds(snapshot({ type: 'page', page_id: 'unknown' }))).toEqual([]);
  });
});

describe('extractPageDescription', () => {
  const describePage = (children: unknown[], extraView: object = {}) =>
    extractPageDescription(doc(children, 'Page title', extraView));

  it('uses the opening prose of the rich fixture', () => {
    expect(extractPageDescription(publishedRichDocumentPayload)).toBe(
      'Plain, bold, bold italic, code, struck, underlined and a link. First bullet, Nested bullet, Second bullet, Step one, Step two, Done task, Open task…'
    );
  });

  it('never includes the page title', () => {
    expect(describePage([blk('paragraph', [leaf('Body text.')])])).toBe('Body text.');
  });

  it.each([
    ['heading', blk('heading', [leaf('Heading')], { level: 1 })],
    ['code', blk('code', [leaf('const x = 1;')])],
    ['equation', blk('math_equation', null, { formula: 'E=mc^2' })],
    [
      'table',
      blk('simple_table', null, {}, [
        blk('simple_table_row', null, {}, [blk('simple_table_cell', null, {}, [blk('paragraph', [leaf('Cell')])])]),
      ]),
    ],
    ['unknown block', blk('future_block', [leaf('Future')])],
  ])('skips %s text', (_label, block) => {
    expect(describePage([block, blk('paragraph', [leaf('Prose.')])])).toBe('Prose.');
  });

  it('reads nested prose in document order', () => {
    expect(
      describePage([
        blk('toggle_list', [leaf('Question?')], {}, [blk('paragraph', [leaf('Answer.')])]),
        blk('simple_columns', null, {}, [blk('simple_column', null, {}, [blk('paragraph', [leaf('Column.')])])]),
      ])
    ).toBe('Question? Answer. Column.');
  });

  it('uses mention labels instead of their placeholder text', () => {
    expect(
      describePage(
        [
          blk('paragraph', [
            leaf('Ask '),
            leaf('$', { mention: { type: 'person', person_id: 'p', person_name: 'Ada' } }),
            leaf(' about '),
            leaf('$', { mention: { type: 'page', page_id: 'c' } }),
            leaf(' by '),
            leaf('$', { mention: { type: 'date', date: '2026-09-30T00:00:00.000Z' } }),
            leaf('.'),
          ]),
        ],
        { childViews: [{ view_id: 'c', name: 'Child' }] }
      )
    ).toBe('Ask Ada about Child by 2026-09-30.');
  });

  it('separates blocks that do not end a sentence with commas', () => {
    expect(
      describePage([
        blk('paragraph', [leaf('Intro sentence.')]),
        blk('bulleted_list', [leaf('First item')]),
        blk('bulleted_list', [leaf('Second item')]),
        blk('paragraph', [leaf('Question?')]),
        blk('paragraph', [leaf('Answer')]),
      ])
    ).toBe('Intro sentence. First item, Second item, Question? Answer');
  });

  it('collapses whitespace and line breaks', () => {
    expect(describePage([blk('paragraph', [leaf('  a\n\n  b\t c  ')]), blk('paragraph', [leaf('d')])])).toBe(
      'a b c, d'
    );
  });

  it('truncates at a word boundary with an ellipsis', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const description = describePage([blk('paragraph', [leaf(words)])]) ?? '';

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith('…')).toBe(true);
    expect(words.startsWith(description.slice(0, -1))).toBe(true);
    expect(description.slice(0, -1)).toMatch(/word\d+$/);
  });

  it('drops trailing punctuation before the ellipsis', () => {
    const text = `${'a'.repeat(100)}, ${'b'.repeat(100)}`;

    expect(describePage([blk('paragraph', [leaf(text)])])).toBe(`${'a'.repeat(100)}…`);
  });

  it('cuts a single overlong word rather than returning almost nothing', () => {
    const description = describePage([blk('paragraph', [leaf(`https://example.com/${'x'.repeat(300)}`)])]) ?? '';

    expect(description.length).toBe(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith('…')).toBe(true);
  });

  it('keeps text of exactly the maximum length untouched', () => {
    const text = 'x'.repeat(DESCRIPTION_MAX_LENGTH);

    expect(describePage([blk('paragraph', [leaf(text)])])).toBe(text);
  });

  it('returns plain text, leaving escaping to the caller', () => {
    expect(describePage([blk('paragraph', [leaf('Tom & "Jerry" <b>')])])).toBe('Tom & "Jerry" <b>');
  });

  it.each([
    ['an empty document', doc([])],
    ['a document with only headings', doc([blk('heading', [leaf('H')], { level: 1 })])],
    ['whitespace-only prose', doc([blk('paragraph', [leaf('   ')])])],
    ['a database snapshot', publishedDatabasePayload],
    ['null', null],
    ['a malformed document', { kind: 'document', document: { children: 'nope' } }],
  ])('returns undefined for %s', (_label, input) => {
    expect(extractPageDescription(input)).toBeUndefined();
  });
});
