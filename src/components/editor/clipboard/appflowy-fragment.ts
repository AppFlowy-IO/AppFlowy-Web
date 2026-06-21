import { Element, Node as SlateNode, Text } from 'slate';

import { BlockType, YjsEditorKey } from '@/application/types';

export const APPFLOWY_FRAGMENT_MIME = 'application/x-appflowy-fragment';
export const APPFLOWY_HTML_FRAGMENT_ATTR = 'data-appflowy-fragment';

const DESKTOP_IN_APP_JSON_FORMATS = [
  'io.appflowy.InAppJsonType',
  'application/x-private;appId=io.appflowy.InAppJsonType',
  'application/x-private;appid=io.appflowy.InAppJsonType',
];

const DESKTOP_TABLE_JSON_FORMATS = [
  'io.appflowy.TableJsonType',
  'application/x-private;appId=io.appflowy.TableJsonType',
  'application/x-private;appid=io.appflowy.TableJsonType',
];

const KNOWN_BLOCK_TYPES = new Set<string>(Object.values(BlockType));

type JsonRecord = Record<string, unknown>;

interface DesktopDeltaInsert {
  insert?: unknown;
  attributes?: unknown;
}

interface DesktopNode {
  type: string;
  data?: JsonRecord;
  children?: DesktopNode[];
}

interface RichClipboardCandidate {
  source: string;
  value: string;
}

interface ClipboardFragmentReader {
  id: string;
  read(data: Pick<DataTransfer, 'getData'>): RichClipboardCandidate[];
  parse(raw: string): SlateNode[] | null;
}

export interface RichClipboardFragment {
  source: string;
  fragment: SlateNode[];
}

const CLIPBOARD_FRAGMENT_READERS: ClipboardFragmentReader[] = [
  createFormatReader('appflowy-web-fragment', [APPFLOWY_FRAGMENT_MIME]),
  createFormatReader('appflowy-desktop-in-app-json', DESKTOP_IN_APP_JSON_FORMATS),
  createFormatReader('appflowy-desktop-table-json', DESKTOP_TABLE_JSON_FORMATS),
  createFormatReader(
    'appflowy-application-json',
    [
      // Generic JSON is shared by many apps, so accept only the full AppFlowy
      // document envelope here. Trusted AppFlowy-specific formats above can
      // still carry raw node arrays.
      'application/json',
    ],
    appFlowyDocumentPayloadToSlateFragment
  ),
  {
    id: 'appflowy-html-fragment',
    read(data) {
      const html = getClipboardData(data, 'text/html');
      const value = extractAppFlowyFragmentFromHTML(html);

      return value
        ? [
            {
              source: `text/html:${APPFLOWY_HTML_FRAGMENT_ATTR}`,
              value,
            },
          ]
        : [];
    },
    parse: clipboardPayloadToSlateFragment,
  },
];

export function extractAppFlowyClipboardFragment(data: Pick<DataTransfer, 'getData'>): RichClipboardFragment | null {
  for (const reader of CLIPBOARD_FRAGMENT_READERS) {
    for (const candidate of reader.read(data)) {
      const fragment = reader.parse(candidate.value);

      if (fragment) {
        return {
          source: candidate.source,
          fragment,
        };
      }
    }
  }

  return null;
}

export function clipboardPayloadToSlateFragment(raw: string): SlateNode[] | null {
  const payload = decodeClipboardPayload(raw);

  if (!payload) return null;

  return payloadToSlateFragment(payload);
}

export function payloadToSlateFragment(payload: unknown): SlateNode[] | null {
  if (isSlateFragment(payload) && !containsDesktopDelta(payload)) {
    return normalizeSlateFragment(payload);
  }

  return appFlowyDocumentToSlateFragment(payload);
}

export function appFlowyDocumentToSlateFragment(payload: unknown): SlateNode[] | null {
  const nodes = getDesktopTopLevelNodes(payload);

  if (!nodes) return null;

  const fragment = nodes.map(desktopNodeToSlateElement).filter(Boolean) as Element[];

  return fragment.length > 0 ? fragment : null;
}

function appFlowyDocumentPayloadToSlateFragment(raw: string): SlateNode[] | null {
  const payload = decodeClipboardPayload(raw);

  if (!isAppFlowyDocumentEnvelope(payload)) return null;

  return appFlowyDocumentToSlateFragment(payload);
}

function createFormatReader(
  id: string,
  formats: string[],
  parse: ClipboardFragmentReader['parse'] = clipboardPayloadToSlateFragment
): ClipboardFragmentReader {
  return {
    id,
    read(data) {
      return formats.flatMap((source) => {
        const value = getClipboardData(data, source);

        return value ? [{ source, value }] : [];
      });
    },
    parse,
  };
}

function getClipboardData(data: Pick<DataTransfer, 'getData'>, type: string): string {
  try {
    return data.getData(type) || '';
  } catch {
    return '';
  }
}

export function extractAppFlowyFragmentFromHTML(html: string | undefined): string | undefined {
  if (!html) return undefined;

  const match = html.match(/\sdata-appflowy-fragment=(["'])(.+?)\1/m);

  return match ? decodeHtmlAttribute(match[2]) : undefined;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

function decodeClipboardPayload(raw: string): unknown | null {
  const trimmed = raw.trim();

  if (!trimmed) return null;

  const jsonPayload = parseJson(trimmed);

  if (jsonPayload !== null) return jsonPayload;

  for (const decoded of decodeEncodedPayloads(trimmed)) {
    const payload = parseJson(decoded);

    if (payload !== null) return payload;
  }

  return null;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeEncodedPayloads(value: string): string[] {
  const decoded: string[] = [];

  try {
    decoded.push(decodeURIComponent(value));
  } catch {
    // ignore
  }

  const base64 = decodeBase64(value);

  if (base64) {
    const utf8 = decodeBinaryUtf8(base64.binary);

    if (utf8) decoded.push(utf8);

    if (base64.binary.includes('%')) {
      try {
        decoded.push(decodeURIComponent(base64.binary));
      } catch {
        // Web copy uses URI-encoded JSON before base64.
      }
    }

    decoded.push(base64.binary);
  }

  return Array.from(new Set(decoded));
}

function decodeBase64(value: string): { binary: string } | null {
  try {
    if (typeof globalThis.atob === 'function') {
      return {
        binary: globalThis.atob(value),
      };
    }

    if (typeof Buffer !== 'undefined') {
      return {
        binary: Buffer.from(value, 'base64').toString('binary'),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function decodeBinaryUtf8(binary: string): string | null {
  try {
    if (typeof TextDecoder !== 'undefined') {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

      return new TextDecoder().decode(bytes);
    }

    if (typeof Buffer !== 'undefined') {
      return Buffer.from(binary, 'binary').toString('utf8');
    }
  } catch {
    return null;
  }

  return null;
}

function isAppFlowyDocumentEnvelope(payload: unknown): boolean {
  const document = asRecord(payload)?.document;

  return isDesktopNode(document) && document.type === BlockType.Page;
}

function getDesktopTopLevelNodes(payload: unknown): DesktopNode[] | null {
  const document = asRecord(payload)?.document;

  if (isDesktopNode(document)) {
    return document.type === BlockType.Page ? document.children ?? [] : [document];
  }

  if (Array.isArray(payload) && payload.every(isDesktopNode)) {
    return payload;
  }

  if (isDesktopNode(payload)) {
    return payload.type === BlockType.Page ? payload.children ?? [] : [payload];
  }

  return null;
}

function desktopNodeToSlateElement(node: DesktopNode): Element | null {
  if (!node.type) return null;

  const data = omitDelta(node.data);
  const textChildren = deltaToSlateTextChildren(node.data?.delta);
  const nestedChildren = (node.children ?? []).map(desktopNodeToSlateElement).filter(Boolean) as Element[];

  return {
    type: node.type,
    data,
    children: [
      {
        type: YjsEditorKey.text,
        children: textChildren,
      } as Element,
      ...nestedChildren,
    ],
  };
}

function deltaToSlateTextChildren(delta: unknown): Text[] {
  if (!Array.isArray(delta)) {
    return [
      {
        text: '',
      },
    ];
  }

  const textNodes = delta.flatMap((op: DesktopDeltaInsert) => {
    if (typeof op?.insert !== 'string') return [];

    const attributes = asRecord(op.attributes) ?? {};

    return [
      {
        ...attributes,
        text: op.insert,
      } as Text,
    ];
  });

  return textNodes.length > 0
    ? textNodes
    : [
        {
          text: '',
        },
      ];
}

function omitDelta(data: unknown): JsonRecord {
  const record = asRecord(data);

  if (!record) return {};

  const sanitized: JsonRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (key === YjsEditorKey.delta) continue;
    if (value === undefined || value === null) continue;
    sanitized[key] = value;
  }

  return sanitized;
}

function normalizeSlateFragment(fragment: SlateNode[]): SlateNode[] {
  return fragment.map(normalizeSlateNode).filter(Boolean) as SlateNode[];
}

function normalizeSlateNode(node: SlateNode): SlateNode | null {
  if (Text.isText(node)) return node;
  if (!Element.isElement(node)) return null;

  const children = node.children.map(normalizeSlateNode).filter(Boolean) as SlateNode[];

  if (children.length === 0) {
    children.push({
      type: YjsEditorKey.text,
      children: [
        {
          text: '',
        },
      ],
    } as Element);
  }

  return {
    ...node,
    children,
  };
}

function isSlateFragment(payload: unknown): payload is SlateNode[] {
  return Array.isArray(payload) && payload.every(isSlateNodeLike);
}

function isSlateNodeLike(value: unknown): value is SlateNode {
  if (Text.isText(value)) return true;
  if (!Element.isElement(value)) return false;

  return typeof value.type === 'string' && Array.isArray(value.children);
}

function containsDesktopDelta(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(containsDesktopDelta);

  const record = asRecord(payload);

  if (!record) return false;

  const data = asRecord(record.data);

  if (Array.isArray(data?.delta)) return true;

  return Array.isArray(record.children) && record.children.some(containsDesktopDelta);
}

function isDesktopNode(value: unknown): value is DesktopNode {
  const record = asRecord(value);

  if (!record || typeof record.type !== 'string' || !KNOWN_BLOCK_TYPES.has(record.type)) return false;

  const children = record.children;

  return children === undefined || (Array.isArray(children) && children.every(isDesktopNode));
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}
