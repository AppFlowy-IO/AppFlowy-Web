import { toHexString } from 'lib0/buffer';
import { digest } from 'lib0/hash/sha256';
import { encodeUtf8 } from 'lib0/string';
import isEqual from 'lodash-es/isEqual';
import * as Y from 'yjs';

import { DATABASE_ROW_TEMPLATES_KEY } from './types';

// Keep these keys and the projection fingerprint identical to Desktop's
// flowy-database2 row_template.rs. Flat entries also merge on first upgrade.
const TEMPLATE_PREFIX = 'row_template_v2:';
const PROJECTION_HASH_KEY = 'row_templates_projection_sha256';

export type PersistedTemplateRecord = Record<string, unknown> & { template_id: string };

function isRecord(value: unknown): value is PersistedTemplateRecord {
  return typeof value === 'object' && value !== null && 'template_id' in value && typeof value.template_id === 'string';
}

function parseProjection(json: string): PersistedTemplateRecord[] {
  try {
    const value: unknown = JSON.parse(json);

    return Array.isArray(value) ? value.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function projection(metas?: Y.Map<unknown>): string {
  const value = metas?.get(DATABASE_ROW_TEMPLATES_KEY);

  return typeof value === 'string' ? value : '';
}

function projectionHash(json: string): string {
  return toHexString(digest(encodeUtf8(json)));
}

function wasWrittenByLegacyClient(metas: Y.Map<unknown> | undefined, json: string): boolean {
  const hash = metas?.get(PROJECTION_HASH_KEY);

  return typeof hash === 'string' && hash !== projectionHash(json);
}

function readEntries(metas?: Y.Map<unknown>): Map<string, PersistedTemplateRecord | null> {
  const entries = new Map<string, PersistedTemplateRecord | null>();

  metas?.forEach((json, key) => {
    if (!key.startsWith(TEMPLATE_PREFIX) || typeof json !== 'string') return;
    const id = key.slice(TEMPLATE_PREFIX.length);

    try {
      const value: unknown = JSON.parse(json);

      if (value === null || (isRecord(value) && value.template_id === id)) entries.set(id, value);
    } catch {
      // A malformed sibling must not hide other templates.
    }
  });
  return entries;
}

/** Read without mutating Yjs: this also serves React's external-store getter. */
export function readTemplateRecords(metas?: Y.Map<unknown>): PersistedTemplateRecord[] {
  const json = projection(metas);
  const templates = parseProjection(json);

  if (wasWrittenByLegacyClient(metas, json)) return templates;
  const entries = readEntries(metas);
  const merged: PersistedTemplateRecord[] = [];

  templates.forEach((template) => {
    const updated = entries.get(template.template_id);

    entries.delete(template.template_id);
    if (updated !== null) merged.push(updated ?? template);
  });
  Array.from(entries.keys())
    .sort()
    .forEach((id) => {
      const template = entries.get(id);

      if (template) merged.push(template);
    });
  return merged;
}

/** Call inside the database transaction so the array and hash travel together. */
export function writeTemplateRecords(metas: Y.Map<unknown>, templates: PersistedTemplateRecord[]): void {
  const json = projection(metas);
  const legacyWrite = wasWrittenByLegacyClient(metas, json);
  const previous = new Map<string, PersistedTemplateRecord | null>(
    readTemplateRecords(metas).map((template) => [template.template_id, template])
  );

  if (legacyWrite) {
    // Import older-client edits/deletes before resuming upgraded writes.
    readEntries(metas).forEach((template, id) => previous.set(id, template));
  }

  templates.forEach((template) => {
    if (!isEqual(previous.get(template.template_id), template)) {
      metas.set(`${TEMPLATE_PREFIX}${template.template_id}`, JSON.stringify(template));
    }

    previous.delete(template.template_id);
  });
  previous.forEach((template, id) => {
    if (template !== null) metas.set(`${TEMPLATE_PREFIX}${id}`, 'null');
  });

  const nextJson = JSON.stringify(templates);

  if (nextJson !== json || legacyWrite) {
    metas.set(DATABASE_ROW_TEMPLATES_KEY, nextJson);
    metas.set(PROJECTION_HASH_KEY, projectionHash(nextJson));
  }
}

/** Refresh old-server readers after independent records merge on this client. */
export function repairTemplateProjection(metas: Y.Map<unknown>): void {
  const json = projection(metas);
  const templates = readTemplateRecords(metas);

  if (!isEqual(parseProjection(json), templates)) {
    const nextJson = JSON.stringify(templates);

    metas.set(DATABASE_ROW_TEMPLATES_KEY, nextJson);
    metas.set(PROJECTION_HASH_KEY, projectionHash(nextJson));
  }
}
