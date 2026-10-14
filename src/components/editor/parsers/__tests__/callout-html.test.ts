import { BlockType } from '@/application/types';
import { parseHTML } from '../html-parser';

// Exact clipboard fixtures from Flutter's _html_samples.dart, samples 6 and 7.
const calloutFromNotion1 = `<meta charset='utf-8'><p>&lt;aside&gt;
🔥</p>
<p>This is a multi-line callout block</p>
<ol>
<li>It has a nested numbered list
&lt;/aside&gt;</li>
</ol>
<!-- notionvc: 874c60e4-ef71-4930-8421-83de464a2022 -->`;
const calloutFromNotion2 = `<meta charset='utf-8'><p>&lt;aside&gt;
&lt;img src=&quot;/icons/boot_brown.svg&quot; alt=&quot;/icons/boot_brown.svg&quot; width=&quot;40px&quot; /&gt;</p>
<p>&lt;/aside&gt;</p>
<!-- notionvc: 0097dac5-0b79-4d3b-aa4d-140c382842fd -->`;

describe('Flutter callout HTML paste parity', () => {
  it('sample 6 - paste callout from Notion with emoji and nested numbered list', () => {
    const nodes = parseHTML(calloutFromNotion1);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: BlockType.CalloutBlock,
      data: { icon: '🔥', icon_type: 'emoji' },
      text: 'This is a multi-line callout block',
    });
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0]).toMatchObject({
      type: BlockType.NumberedListBlock,
      text: 'It has a nested numbered list',
    });
  });
  it('sample 7 - paste empty callout from Notion without treating an image tag as text', () => {
    const nodes = parseHTML(calloutFromNotion2);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: BlockType.CalloutBlock, text: '', children: [] });
  });
  it('preserves formatting, nested blocks, and content after a real HTML aside', () => {
    const nodes = parseHTML('<aside><p>A <b>highlighted</b> callout</p><ol><li>Nested</li></ol></aside><p>After</p>');

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      type: BlockType.CalloutBlock,
      text: 'A highlighted callout',
      formats: [{ type: 'bold', start: 2, end: 13 }],
      children: [{ type: BlockType.NumberedListBlock, text: 'Nested' }],
    });
    expect(nodes[1].text).toBe('After');
  });
});

it('keeps direct inline formatting inside a callout', () => {
  const nodes = parseHTML('<aside>Hello <strong>world</strong>!</aside>');

  expect(nodes[0]).toMatchObject({
    type: BlockType.CalloutBlock,
    text: 'Hello world!',
    formats: [{ type: 'bold', start: 6, end: 11 }],
  });
});

it('preserves a leading list as a nested block instead of flattening it', () => {
  const nodes = parseHTML('<aside><ul><li>First list item</li></ul></aside>');

  expect(nodes[0]).toMatchObject({
    type: BlockType.CalloutBlock,
    text: '',
    children: [{ type: BlockType.BulletedListBlock, text: 'First list item' }],
  });
});

it.each([
  '<p>&lt;aside&gt;Not a standalone marker&lt;/aside&gt;</p><p>After</p>',
  '<p>&lt;aside&gt;</p><p>Unclosed markup</p>',
])('does not consume ordinary or unclosed escaped HTML: %s', (html) => {
  const nodes = parseHTML(html);

  expect(nodes).toHaveLength(2);
  expect(nodes.every((node) => node.type === BlockType.Paragraph)).toBe(true);
  expect(nodes[0].text).toContain('<aside>');
});
