/**
 * Reads the @-mention typeahead contract's parity fixtures, `__fixtures__/mention-parity/`: the same
 * bytes AppFlowy-Cloud-Premium keeps canonically in `libs/appflowy-entity/fixtures/mention-parity/`
 * and Desktop in `frontend/resources/mention-parity/`, all checked against one `FIXTURES.sha256`.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { TextDecoder } from 'util';

export const MENTION_PARITY_DIR = join(__dirname, '..', '__fixtures__', 'mention-parity');
export const MENTION_PARITY_MANIFEST = 'FIXTURES.sha256';
export const MENTION_PARITY_MANIFEST_HEADER =
  '# mention-parity v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md';
/** The contract version every fixture file carries. */
export const MENTION_CONTRACT_VERSION = 1;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Every file of the folder, the manifest included, as `/`-separated paths in byte order. */
export function listMentionParityFiles(dir = MENTION_PARITY_DIR): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const path = join(current, entry.name);

      if (entry.isDirectory()) walk(path);
      else files.push(relative(dir, path).split(sep).join('/'));
    });
  };

  walk(dir);
  return files.sort(byteOrder);
}

export function readMentionParityFile(name: string, dir = MENTION_PARITY_DIR): Buffer {
  return readFileSync(join(dir, name));
}

export function loadMentionParityFixture<T>(name: string): T {
  return JSON.parse(readMentionParityFile(name).toString('utf8')) as T;
}

/**
 * What the README's command writes: the header, then `<sha256>  <path>` for every file but the
 * manifest, in byte (`LC_ALL=C`) path order, each line ending in one newline.
 */
export function computeMentionParityManifest(dir = MENTION_PARITY_DIR): string {
  const lines = listMentionParityFiles(dir)
    .filter((path) => path !== MENTION_PARITY_MANIFEST)
    .map((path) => `${createHash('sha256').update(readMentionParityFile(path, dir)).digest('hex')}  ${path}`);

  return [MENTION_PARITY_MANIFEST_HEADER, ...lines].join('\n') + '\n';
}

/**
 * The fixture README's byte rules: UTF-8 without a BOM, LF line endings, exactly one trailing
 * newline and, for JSON, valid JSON indented with multiples of two spaces.
 */
export function mentionParityByteRuleViolations(name: string, bytes: Uint8Array): string[] {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return [`${name}: not UTF-8`];
  }

  const problems: string[] = [];

  if (text.startsWith('\ufeff')) problems.push(`${name}: starts with a BOM`);
  if (text.includes('\r')) problems.push(`${name}: contains a carriage return`);
  if (!text.endsWith('\n') || text.endsWith('\n\n')) problems.push(`${name}: must end with exactly one newline`);
  if (name.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch (error) {
      problems.push(`${name}: not valid JSON: ${String(error)}`);
    }

    text.split('\n').forEach((line, index) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';

      if (indent.includes('\t') || indent.length % 2 !== 0) {
        problems.push(`${name}:${index + 1}: indentation is not 2-space`);
      }
    });
  }

  return problems;
}
