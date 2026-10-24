/**
 * svg-norm/1 (VISUAL-PARITY.md §4.2): the glyph identity of an SVG, with paint
 * and the root's rendered size removed. Port of the reference
 * implementation `scratchpad/visual-parity/svg-norm.mjs`; both probes must
 * reproduce `icons.json` `normalizationVectors`.
 */
import { createHash } from 'crypto';

const PAINT_ATTRS = new Set(['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color']);
const PAINT_KEEP = new Set(['none', 'transparent', 'currentcolor', 'inherit']);
const ROOT_DROP = new Set([
  'width',
  'height',
  'class',
  'style',
  'role',
  'focusable',
  'version',
  'xmlns:xlink',
  'xml:space',
  'id',
]);
const SKIP_ELEMENTS = new Set(['title', 'desc', 'metadata']);

interface SvgElementNode {
  name: string;
  attrs: [string, string][];
  children: SvgNode[];
}

type SvgNode = SvgElementNode | { text: string };

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    return String.fromCodePoint(parseInt(entity.slice(1), 10));
  });
}

const collapse = (value: string) => value.replace(/[ \t\r\n]+/g, ' ').trim();
const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseAttrs(source: string): [string, string][] {
  const attrs: [string, string][] = [];
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(source);

  while (match) {
    attrs.push([match[1], collapse(decodeEntities(match[3] ?? match[4] ?? ''))]);
    match = pattern.exec(source);
  }

  return attrs;
}

function parse(text: string): SvgElementNode {
  const source = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root: SvgElementNode = { name: '#root', attrs: [], children: [] };
  const stack: SvgElementNode[] = [root];
  const pattern = /<\/?([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  let match = pattern.exec(source);

  while (match) {
    const top = stack[stack.length - 1];

    if (match[4] !== undefined) {
      const content = collapse(decodeEntities(match[4]));

      if (content) top.children.push({ text: content });
    } else if (match[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else {
      const element: SvgElementNode = { name: match[1], attrs: parseAttrs(match[2]), children: [] };

      top.children.push(element);
      if (match[3] !== '/') stack.push(element);
    }

    match = pattern.exec(source);
  }

  return root;
}

function serialize(node: SvgNode, isRoot: boolean): string {
  if ('text' in node) return escapeText(node.text);
  if (SKIP_ELEMENTS.has(node.name)) return '';
  const attrs: [string, string][] = [];

  for (const [name, raw] of node.attrs) {
    if (isRoot && (ROOT_DROP.has(name) || name.startsWith('aria-') || name.startsWith('data-'))) continue;
    let value = raw;

    if (PAINT_ATTRS.has(name)) {
      const lower = value.toLowerCase();

      if (lower === 'currentcolor' || (!PAINT_KEEP.has(lower) && !value.startsWith('url('))) value = 'currentColor';
    }

    attrs.push([name, value]);
  }

  attrs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const open = `<${node.name}${attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('')}`;
  const inner = node.children.map((child) => serialize(child, false)).join('');

  return inner ? `${open}>${inner}</${node.name}>` : `${open}/>`;
}

/** The svg-norm/1 string of an SVG document or of an inline `<svg>`'s outerHTML. */
export function normalizeSvg(text: string): string {
  const root = parse(text);
  const svg = root.children.find((child): child is SvgElementNode => 'name' in child && child.name === 'svg');

  if (!svg) throw new Error('no <svg> root element');
  return serialize(svg, true);
}

/** sha256 (lowercase hex) of the svg-norm/1 string. */
export function svgNormHash(text: string): string {
  return createHash('sha256').update(normalizeSvg(text), 'utf8').digest('hex');
}
