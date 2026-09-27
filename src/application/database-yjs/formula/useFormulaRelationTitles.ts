import { useLayoutEffect } from 'react';

import { FormulaFieldSchema } from '@/application/database-yjs/fields/formula';
import type { BackgroundRowDocChange } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { retainRelationGroupLabels } from '@/application/database-yjs/relation/cache';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export interface FormulaRowSources {
  rows?: Record<string, YDoc> | null;
  rowIds?: readonly string[];
  /** Timeline calculations can also evaluate detached, background-loaded rows. */
  getCachedRowDocs?: () => Record<string, YDoc>;
  subscribeToCachedRowDocChanges?: (notify: (change: BackgroundRowDocChange) => void) => () => void;
}

/** Keep every title in an active formula condition/calculation available across evaluation passes. */
export function useFormulaRelationTitles(
  relations: FormulaFieldSchema[],
  { rows, rowIds, getCachedRowDocs, subscribeToCachedRowDocChanges }: FormulaRowSources
) {
  // Acquire retention before consumers evaluate, including timeline layout effects.
  useLayoutEffect(() => {
    if (relations.length === 0) return;
    const selectedIds = rowIds ? new Set(rowIds) : undefined;
    const cached = new Map<string, YDoc>();
    const observed = new Map<YDoc, () => void>();
    const observeRow = (doc: YDoc) => {
      const root = doc.getMap(YjsEditorKey.data_section);
      let signature = '';
      let release: () => void = () => undefined;
      const update = () => {
        const row = root.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
        const cells = row?.get(YjsDatabaseKey.cells);
        const references = relations.map((entry) => ({ entry, ids: getRelationRowIdsFromCell(cells?.get(entry.id)) }));
        const keys = references.flatMap(({ entry, ids }) =>
          ids.map((relatedRowId) => ({
            relationField: entry.field,
            relatedRowId,
          }))
        );
        const nextSignature = JSON.stringify(references.map(({ entry, ids }) => [entry.id, ids]));

        if (nextSignature === signature) return;
        signature = nextSignature;
        // Retain replacements before releasing old keys to avoid evicting a
        // still-needed title while the active set exceeds the cache limit.
        const nextRelease = retainRelationGroupLabels(keys);

        release();
        release = nextRelease;
      };

      const unsubscribe = subscribeSharedYjsDeep(root, update);

      update();
      return () => {
        unsubscribe();
        release();
      };
    };

    const sync = () => {
      const docs = new Set<YDoc>();

      Object.entries(rows ?? {}).forEach(([id, doc]) => {
        if (!selectedIds || selectedIds.has(id)) docs.add(doc);
      });
      cached.forEach((doc, id) => {
        if (!selectedIds || selectedIds.has(id)) docs.add(doc);
      });
      docs.forEach((doc) => {
        if (!observed.has(doc)) observed.set(doc, observeRow(doc));
      });
      observed.forEach((cleanup, doc) => {
        if (docs.has(doc)) return;
        cleanup();
        observed.delete(doc);
      });
    };

    const unsubscribeCached = subscribeToCachedRowDocChanges?.(({ added, removed }) => {
      Object.entries(removed).forEach(([id, doc]) => {
        if (cached.get(id) === doc) cached.delete(id);
      });
      Object.entries(added).forEach(([id, doc]) => cached.set(id, doc));
      sync();
    });

    Object.entries(getCachedRowDocs?.() ?? {}).forEach(([id, doc]) => cached.set(id, doc));
    sync();
    return () => {
      unsubscribeCached?.();
      observed.forEach((cleanup) => cleanup());
    };
  }, [relations, rows, rowIds, getCachedRowDocs, subscribeToCachedRowDocChanges]);
}
