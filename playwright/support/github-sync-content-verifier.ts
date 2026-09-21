/** Independent BDD oracle: fresh pinned GitHub Markdown versus a fresh authenticated Yjs read. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { assertSuccessfulAppFlowyResponse } from './appflowy-response';

import type { GitHubSyncStatus } from '../../src/application/integrations/github-sync';
import type { Page } from '@playwright/test';
import type { Definition, Nodes, Root } from 'mdast';

type Run = { text: string; marks: Record<string, unknown> };
type Block = {
  kind: string;
  properties: Record<string, unknown>;
  text: Run[];
  children: Block[];
  id?: string;
};
type UrlOverrides = { links?: Map<string, string>; images?: Map<string, string> };
type TreeEntry = { path: string; type: string; sha: string; mode: string };
type PersistedPage = {
  view: { view_id: string; parent_view_id: string | null };
  data: { encoded_collab: number[] };
};
type ParsedSource = { markdown: string; ast: Root; definitions: Map<string, Definition>; slugs: string[] };

export type GithubContentVerification = {
  pages: number;
  folders: number;
  commitSha: string;
  blocks: number;
  images: number;
  entries: Array<{ viewId: string; path: string }>;
};

const block = (kind: string): Block => ({ kind, properties: {}, text: [], children: [] });
const referenceId = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) node.children.forEach((child) => walk(child, visit));
}

function inlineText(node: Nodes): string {
  if ('value' in node) return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  return 'children' in node ? node.children.map(inlineText).join('') : '';
}

function parseSource(markdown: string): ParsedSource {
  const ast = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const definitions = new Map<string, Definition>();
  const slugs: string[] = [];
  const used = new Set<string>();

  walk(ast, (node) => {
    if (node.type === 'definition' && !definitions.has(referenceId(node.identifier))) {
      definitions.set(referenceId(node.identifier), node);
    }

    if (node.type === 'heading') {
      const base = inlineText(node)
        .toLowerCase()
        .replace(/ /g, '-')
        // Combining marks intentionally remain part of a source heading anchor.
        // eslint-disable-next-line no-misleading-character-class
        .replace(/[^\p{L}\p{N}_\-\u0300-\u036f]/gu, '');
      let slug = base;
      let suffix = 1;

      while (used.has(slug)) slug = `${base}-${suffix++}`;
      used.add(slug);
      slugs.push(slug);
    }
  });
  return { markdown, ast, definitions, slugs };
}

function pushRun(runs: Run[], text: string, marks: Run['marks']): void {
  if (!text) return;
  const normalized = Object.fromEntries(Object.entries(marks).sort(([a], [b]) => a.localeCompare(b)));
  const previous = runs[runs.length - 1];

  if (previous && JSON.stringify(previous.marks) === JSON.stringify(normalized)) previous.text += text;
  else runs.push({ text, marks: normalized });
}

function canonicalize(runs: Run[]): Run[] {
  const result: Run[] = [];

  runs.forEach((run) => pushRun(result, run.text, run.marks));
  return result;
}

function trimBoundaryNewline(runs: Run[], start: boolean): Run[] {
  const run = start ? runs[0] : runs[runs.length - 1];

  if (run) run.text = start ? run.text.replace(/^\n/, '') : run.text.replace(/\n$/, '');
  return canonicalize(runs);
}

function codeLanguage(language: string): string {
  const aliases: Record<string, string> = {
    jsx: 'javascript',
    javascriptreact: 'javascript',
    tsx: 'typescript',
    typescriptreact: 'typescript',
    sh: 'bash',
    zsh: 'bash',
    fish: 'bash',
    yml: 'yaml',
    'objective-c': 'objectivec',
    objc: 'objectivec',
    dockerfile: 'docker',
    jsonc: 'json',
    cplusplus: 'c++',
    cc: 'c++',
    cxx: 'c++',
    csharp: 'c#',
    cs: 'c#',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin',
    kts: 'kotlin',
    md: 'markdown',
  };
  const lower = language.toLowerCase();

  return aliases[lower] ?? lower;
}

/** Presentation conventions are normalized here; no production Markdown converter is imported. */
function expectedDocument(source: ParsedSource, urls: UrlOverrides, viewId?: string): Block {
  let headingIndex = 0;
  const definition = (id: string) => {
    const result = source.definitions.get(referenceId(id));

    assert(result, `missing source reference ${id}`);
    return result;
  };

  const inline = (nodes: Nodes[], marks: Run['marks'] = {}): Run[] => {
    const runs: Run[] = [];

    for (const node of nodes) {
      if (node.type === 'text') pushRun(runs, node.value, marks);
      else if (node.type === 'break') pushRun(runs, '\n', marks);
      else if (node.type === 'inlineCode') pushRun(runs, node.value, { ...marks, code: true });
      else {
        let extra: Run['marks'];

        switch (node.type) {
          case 'strong':
            extra = { bold: true };
            break;
          case 'emphasis':
            extra = { italic: true };
            break;
          case 'delete':
            extra = { strikethrough: true };
            break;
          case 'link':
            extra = { href: urls.links?.get(node.url) ?? node.url };
            break;
          case 'linkReference': {
            const url = definition(node.identifier).url;

            extra = { href: urls.links?.get(url) ?? url };
            break;
          }

          default:
            throw new Error(`unsupported source inline node ${node.type}`);
        }

        assert('children' in node);
        runs.push(...inline(node.children, { ...marks, ...extra }));
      }
    }

    return canonicalize(runs);
  };

  const image = (node: Extract<Nodes, { type: 'image' | 'imageReference' }>): Block => {
    const target = node.type === 'image' ? node : definition(node.identifier);
    const result = block('image');

    result.properties = { image_type: 2, url: urls.images?.get(target.url) ?? target.url, alt: node.alt ?? '' };
    if (typeof target.title === 'string') result.properties.title = target.title;
    return result;
  };

  const paragraph = (nodes: Nodes[]): Block[] => {
    const result: Block[] = [];
    let current = block('paragraph');
    let followsImage = false;

    for (const node of nodes) {
      if (node.type === 'image' || node.type === 'imageReference') {
        if (nodes.length > 1) {
          const start = node.position?.start.offset;
          const end = node.position?.end.offset;

          assert(typeof start === 'number' && typeof end === 'number', 'source image position missing');
          assert.equal(source.markdown.slice(0, start).split('\n').pop()?.trim(), '', 'unsupported inline image');
          assert.equal(source.markdown.slice(end).split('\n')[0].trim(), '', 'unsupported inline image');
          current.text = trimBoundaryNewline(current.text, false);
        }

        if (current.text.length) result.push(current);
        result.push(image(node));
        current = block('paragraph');
        followsImage = true;
      } else {
        let runs = inline([node]);

        if (followsImage) runs = trimBoundaryNewline(runs, true);
        current.text.push(...runs);
        followsImage = false;
      }
    }

    current.text = canonicalize(current.text);
    if (current.text.length || result.length === 0) result.push(current);
    return result;
  };

  const container = (kind: string, nodes: Nodes[]): Block => {
    const result = block(kind);
    const first = nodes[0];

    if (first?.type === 'paragraph') {
      const parts = paragraph(first.children);

      if (parts[0]?.kind === 'paragraph') result.text = parts.shift()!.text;
      result.children = [...parts, ...children(nodes.slice(1))];
    } else result.children = children(nodes);
    return result;
  };

  const project = (node: Nodes): Block[] => {
    switch (node.type) {
      case 'root':
        return [{ ...block('page'), children: children(node.children) }];
      case 'definition':
        return [];
      case 'paragraph':
        return paragraph(node.children);
      case 'heading': {
        const result = { ...block('heading'), properties: { level: node.depth }, text: inline(node.children) };
        const slug = source.slugs[headingIndex++];

        if (viewId) result.id = uuidv5(`heading:${slug}`, viewId);
        return [result];
      }

      case 'blockquote':
        return [container('quote', node.children)];
      case 'list':
        return node.children.map((item) => {
          const result = container(
            typeof item.checked === 'boolean' ? 'todo_list' : node.ordered ? 'numbered_list' : 'bulleted_list',
            item.children
          );

          if (typeof item.checked === 'boolean') result.properties.checked = item.checked;
          if (typeof node.start === 'number') result.properties.number = node.start;
          return result;
        });
      case 'code':
        return [
          {
            ...block('code'),
            properties: { language: codeLanguage(node.lang ?? '') },
            text: canonicalize([{ text: node.value, marks: {} }]),
          },
        ];
      case 'thematicBreak':
        return [block('divider')];
      case 'image':
      case 'imageReference':
        return [image(node)];
      case 'table':
        return [
          {
            ...block('simple_table'),
            children: node.children.map((row, rowIndex) => ({
              ...block('simple_table_row'),
              children: row.children.map((cell, columnIndex) => ({
                ...block('simple_table_cell'),
                properties: {
                  rowPosition: rowIndex,
                  colPosition: columnIndex,
                  align: node.align?.[columnIndex] ?? 'left',
                },
                children: [{ ...block('paragraph'), text: inline(cell.children) }],
              })),
            })),
          },
        ];
      default:
        throw new Error(`unsupported source block ${node.type}`);
    }
  };

  const children = (nodes: Nodes[]) => nodes.flatMap(project);

  return project(source.ast)[0];
}

const propertyKeys: Record<string, string[]> = {
  page: [],
  paragraph: [],
  quote: [],
  divider: [],
  simple_table: [],
  simple_table_row: [],
  heading: ['level'],
  code: ['language'],
  todo_list: ['checked', 'number'],
  numbered_list: ['number'],
  bulleted_list: ['number'],
  image: ['image_type', 'url', 'alt', 'title'],
  simple_table_cell: ['rowPosition', 'colPosition', 'align'],
};

function decodeDocument(encoded: Uint8Array): Block {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, encoded);
    const document = doc.getMap('data').get('document');

    assert(document instanceof Y.Map, 'collab has no document map');
    const blocks = document.get('blocks');
    const meta = document.get('meta');

    assert(blocks instanceof Y.Map && meta instanceof Y.Map, 'collab has no document blocks/meta');
    const childMap = meta.get('children_map');
    const textMap = meta.get('text_map');

    assert(childMap instanceof Y.Map && textMap instanceof Y.Map, 'collab has no child/text maps');
    const seen = new Set<string>();
    const read = (id: string, parent: string): Block => {
      assert(!seen.has(id), `cycle or repeated block reference ${id}`);
      seen.add(id);
      const stored = blocks.get(id);

      assert(stored instanceof Y.Map, `missing persisted block ${id}`);
      assert.equal(stored.get('id'), id, `inconsistent block identity ${id}`);
      assert.equal(stored.get('parent'), parent, `inconsistent parent ${id}`);
      const kind = stored.get('ty') as string;
      const keys = propertyKeys[kind];

      assert(keys, `unexpected persisted block kind ${kind}`);
      const data = JSON.parse(stored.get('data') as string) as Record<string, unknown>;
      const result = { ...block(kind), id };

      for (const key of keys) if (key in data) result.properties[key] = data[key];
      const textId = stored.get('external_id');

      if (textId) {
        assert.equal(stored.get('external_type'), 'text', 'unexpected external content');
        const text = textMap.get(textId as string);

        assert(text instanceof Y.Text, `missing text for ${id}`);
        for (const delta of text.toDelta()) {
          assert.equal(typeof delta.insert, 'string', 'non-text persisted delta');
          const marks: Run['marks'] = {};

          for (const [key, value] of Object.entries(delta.attributes ?? {})) {
            if (value === null || value === undefined || value === false) continue;
            assert(['bold', 'italic', 'strikethrough', 'code', 'href'].includes(key), `unexpected inline mark ${key}`);
            marks[key] = value;
          }

          pushRun(result.text, delta.insert, marks);
        }
      }

      const childIds = childMap.get(stored.get('children') as string);

      if (childIds !== undefined) {
        assert(childIds instanceof Y.Array, `invalid children for ${id}`);
        result.children = childIds.toArray().map((childId) => read(childId as string, id));
      }

      return result;
    };

    const root = read(document.get('page_id') as string, '');

    assert.equal(seen.size, blocks.size, 'unreachable persisted blocks');
    return root;
  } finally {
    doc.destroy();
  }
}

function compare(expected: Block, actual: Block, location: string): void {
  assert.equal(actual.kind, expected.kind, `${location}: block kind differs`);
  if (expected.id) assert.equal(actual.id, expected.id, `${location}: heading target ID differs`);
  assert.deepEqual(actual.properties, expected.properties, `${location}: properties differ`);
  assert.deepEqual(actual.text, expected.text, `${location}: ordered text or formatting differs`);
  assert.equal(actual.children.length, expected.children.length, `${location}: child count differs`);
  expected.children.forEach((child, index) =>
    compare(child, actual.children[index], `${location}/${index}:${child.kind}`)
  );
}

/** Exported for corruption regressions that create actual Yjs documents without any converter. */
export function assertMarkdownMatchesCollab(
  sourcePath: string,
  markdown: string,
  encoded: Uint8Array,
  urls: UrlOverrides = {},
  viewId?: string
): { blocks: number; images: number } {
  const expected = expectedDocument(parseSource(markdown), urls, viewId);
  const actual = decodeDocument(encoded);

  compare(expected, actual, sourcePath);
  const summary = { blocks: 0, images: 0 };
  const count = (item: Block) => {
    if (item.kind !== 'page') summary.blocks++;
    if (item.kind === 'image') summary.images++;
    item.children.forEach(count);
  };

  count(actual);
  return summary;
}

/** Verify a raw file against Git's object hash, including its byte-length header. */
export function assertGitBlob(bytes: Buffer, expectedSha: string, sourcePath: string): void {
  assert(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedSha), `${sourcePath}: invalid Git blob SHA`);
  const hash = createHash(expectedSha.length === 40 ? 'sha1' : 'sha256')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');

  assert.equal(hash, expectedSha, `${sourcePath}: pinned raw bytes differ from Git tree blob`);
}

async function publicBytes(url: URL, maximum: number): Promise<Buffer> {
  // Use a separate Node request, never a browser request that could inherit AppFlowy credentials.
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AppFlowy-BDD-content-verification' },
  });

  assert(response.ok, `public source ${url.pathname}: HTTP ${response.status}`);
  assert(Number(response.headers.get('content-length') ?? 0) <= maximum, 'source response exceeds byte budget');
  const bytes = Buffer.from(await response.arrayBuffer());

  assert(bytes.length <= maximum, 'source response exceeds byte budget');
  return bytes;
}

function rawUrl(repository: string, commit: string, sourcePath: string): URL {
  return new URL(
    `https://raw.githubusercontent.com/${repository}/${commit}/${sourcePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
  );
}

function relativeTarget(sourcePath: string, destination: string): { path: string; fragment: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(destination)) return null;
  const url = new URL(destination, `https://repository.example/${sourcePath}`);

  assert.equal(url.hostname, 'repository.example', 'unexpected external relative source URL');
  return { path: decodeURIComponent(url.pathname).replace(/^\//, ''), fragment: url.hash.slice(1) };
}

async function authenticatedJson<T>(options: VerificationOptions, endpoint: string): Promise<T> {
  const response = await options.page.request.get(new URL(endpoint, options.apiUrl).toString(), {
    headers: { Authorization: `Bearer ${options.accessToken}`, 'Cache-Control': 'no-cache' },
  });
  const bodyText = await response.text();

  assertSuccessfulAppFlowyResponse({ bodyText, ok: response.ok(), operation: endpoint, status: response.status() });
  return (JSON.parse(bodyText) as { data: T }).data;
}

type VerificationOptions = {
  page: Page;
  workspaceId: string;
  bindingId: string;
  spaceId: string;
  apiUrl: string;
  accessToken: string;
};

/** Verify inventory, every source byte/hash, full persisted Markdown semantics and copied images. */
export async function verifyGithubSyncContent(options: VerificationOptions): Promise<GithubContentVerification> {
  const { workspaceId, bindingId, spaceId, apiUrl, page } = options;
  const status = await authenticatedJson<GitHubSyncStatus>(
    options,
    `/api/integrations/github/workspaces/${workspaceId}/bindings/${bindingId}`
  );
  const binding = status.binding;

  assert.equal(binding.space_id, spaceId, 'sync destination differs from requested space');
  assert.equal(binding.workspace_id, workspaceId);
  assert.equal(binding.status, 'synced', `sync has not completed: ${binding.last_error ?? binding.status}`);
  assert.equal(binding.last_error, null);
  const commitSha = binding.last_applied_commit;

  assert(commitSha && /^[a-f0-9]{40,64}$/.test(commitSha), 'binding lacks an applied Git commit');
  const repository = `${binding.repository_owner}/${binding.repository_name}`;
  const root = `${binding.root_path.replace(/^\/+|\/+$/g, '')}/`;
  const treeResponse = JSON.parse(
    (
      await publicBytes(
        new URL(`https://api.github.com/repos/${repository}/git/trees/${commitSha}?recursive=1`),
        32 * 1024 * 1024
      )
    ).toString('utf8')
  ) as { truncated: boolean; tree: TreeEntry[] };

  assert.equal(treeResponse.truncated, false, 'GitHub tree inventory is truncated');
  assert(Array.isArray(treeResponse.tree), 'missing GitHub tree inventory');
  const tree = new Map(treeResponse.tree.map((entry) => [entry.path, entry]));
  const expectedPaths = treeResponse.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith(root) && /\.(md|markdown)$/i.test(entry.path))
    .map((entry) => entry.path)
    .sort();
  const entries = status.entries.filter((entry) => entry.kind === 'file' && entry.lifecycle === 'active');
  const pages = new Map(entries.map((entry) => [entry.path, entry]));
  const directories = status.entries.filter((entry) => entry.kind === 'directory' && entry.lifecycle === 'active');
  const directoryIds = new Map(directories.map((entry) => [entry.path, entry.view_id]));
  const assertPlacement = (entry: { path: string; view_id: string }, persisted: PersistedPage) => {
    const sourceParent = path.posix.dirname(entry.path);
    const expectedParent = sourceParent === root.slice(0, -1) ? spaceId : directoryIds.get(sourceParent);

    assert(expectedParent, `${entry.path}: source parent has no managed directory`);
    assert.equal(persisted.view.view_id, entry.view_id, `${entry.path}: page-view identity differs`);
    assert.equal(persisted.view.parent_view_id, expectedParent, `${entry.path}: persisted parent differs from source hierarchy`);
  };

  const expectedDirectories = new Set<string>();

  for (const sourcePath of expectedPaths) {
    let parent = path.posix.dirname(sourcePath);

    while (parent.startsWith(root)) {
      expectedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }

  assert(expectedPaths.length > 0, 'source docs directory is empty');
  assert.deepEqual(
    entries.map((entry) => entry.path).sort(),
    expectedPaths,
    'persisted page inventory differs from pinned GitHub tree'
  );
  assert.deepEqual(
    status.entries
      .filter((entry) => entry.kind === 'directory' && entry.lifecycle === 'active')
      .map((entry) => entry.path)
      .sort(),
    [...expectedDirectories].sort(),
    'persisted source folder inventory differs from Markdown ancestry'
  );
  const sources = new Map<string, ParsedSource>();
  const rawCache = new Map<string, Buffer>();
  const fetchRaw = async (sourcePath: string): Promise<Buffer> => {
    const cached = rawCache.get(sourcePath);

    if (cached) return cached;
    const metadata = tree.get(sourcePath);

    assert(metadata?.type === 'blob' && metadata.mode !== '120000', `missing or unsafe source blob ${sourcePath}`);
    const bytes = await publicBytes(rawUrl(repository, commitSha, sourcePath), 16 * 1024 * 1024);

    assertGitBlob(bytes, metadata.sha, sourcePath);
    rawCache.set(sourcePath, bytes);
    return bytes;
  };

  for (let index = 0; index < expectedPaths.length; index += 4) {
    await Promise.all(
      expectedPaths.slice(index, index + 4).map(async (sourcePath) => {
        const bytes = await fetchRaw(sourcePath);
        const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

        sources.set(sourcePath, parseSource(markdown));
      })
    );
  }

  const webOrigin = new URL(page.url()).origin;
  const expectedLink = (sourcePath: string, href: string): string => {
    const target = relativeTarget(sourcePath, href);

    if (!target) return href;
    const destination = pages.get(target.path);

    if (destination) {
      const base = `${webOrigin}/app/${workspaceId}/${destination.view_id}`;

      if (!target.fragment) return base;
      const slug = decodeURIComponent(target.fragment);

      if (sources.get(target.path)!.slugs.includes(slug))
        return `${base}?blockId=${uuidv5(`heading:${slug}`, destination.view_id)}`;
    }

    const fallback = new URL(
      `https://github.com/${repository}/blob/${commitSha}/${target.path.split('/').map(encodeURIComponent).join('/')}`
    );

    fallback.hash = target.fragment;
    return fallback.toString();
  };

  const summary: GithubContentVerification = {
    pages: entries.length,
    folders: status.entries.filter((entry) => entry.kind === 'directory' && entry.lifecycle === 'active').length,
    commitSha,
    blocks: 0,
    images: 0,
    entries: entries.map((entry) => ({ viewId: entry.view_id, path: entry.path })),
  };

  for (const entry of directories) {
    const persisted = await authenticatedJson<PersistedPage>(
      options,
      `/api/workspace/${workspaceId}/page-view/${entry.view_id}?_t=${Date.now()}`
    );

    assertPlacement(entry, persisted);
  }

  for (const entry of entries) {
    assert.equal(entry.source_commit_sha, commitSha, `${entry.path}: stale imported revision`);
    assert.equal(entry.last_error, null, `${entry.path}: import reported a failure`);
    const source = sources.get(entry.path)!;
    const links = new Map<string, string>();
    const images = new Map<string, string>();
    const imageDestinations = new Set<string>();

    walk(source.ast, (node) => {
      if (node.type === 'link' || node.type === 'definition') links.set(node.url, expectedLink(entry.path, node.url));
      if (node.type === 'image') imageDestinations.add(node.url);
      if (node.type === 'imageReference') {
        const definition = source.definitions.get(referenceId(node.identifier));

        assert(definition, `${entry.path}: unresolved image reference`);
        imageDestinations.add(definition.url);
      }
    });
    for (const href of imageDestinations) {
      const target = relativeTarget(entry.path, href);

      if (!target) continue;
      const original = await fetchRaw(target.path);
      const hash = createHash('sha256').update(original).digest('hex');
      const extension = path.posix.extname(target.path).slice(1) || 'bin';
      const destination = `${apiUrl.replace(/\/$/, '')}/api/file_storage/${workspaceId}/v1/blob/${
        entry.view_id
      }/${hash}.${extension}`;
      const response = await page.request.get(destination, {
        headers: { Authorization: `Bearer ${options.accessToken}` },
      });

      assert(response.ok(), `${entry.path}: copied image ${target.path} returned HTTP ${response.status()}`);
      assert.deepEqual(await response.body(), original, `${entry.path}: copied image bytes differ for ${target.path}`);
      images.set(href, destination);
    }

    const persisted = await authenticatedJson<PersistedPage>(
      options,
      `/api/workspace/${workspaceId}/page-view/${entry.view_id}?_t=${Date.now()}`
    );

    assertPlacement(entry, persisted);
    assert(Array.isArray(persisted.data?.encoded_collab), `${entry.path}: no persisted document bytes`);
    const verified = assertMarkdownMatchesCollab(
      entry.path,
      source.markdown,
      new Uint8Array(persisted.data.encoded_collab),
      { links, images },
      entry.view_id
    );

    summary.blocks += verified.blocks;
    summary.images += verified.images;
  }

  return summary;
}
