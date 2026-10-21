import { decodeCellToText } from '@/application/database-yjs/decode';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { getRowDocumentSourceFromView } from '@/application/row-document/lifecycle';
import { RowService } from '@/application/services/domains';
import {
  RowDocumentSourcePayload, Types, UIVariant, View, YDatabase, YDatabaseRow, YjsDatabaseKey, YjsEditorKey,
} from '@/application/types';
import type { AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import type { SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { Log } from '@/utils/log';

type BreadcrumbTitleServices = Pick<AppOperationsContextType, 'loadView'> &
  Pick<SyncInternalContextType, 'registerSyncContext' | 'scheduleDeferredCleanup'>;

/** The owner of a breadcrumb's title and logical parent, independent of rendering. */
export abstract class BreadcrumbSource {
  abstract readonly identity: string;
  abstract readonly initialTitle: string;
  abstract readonly parentViewId: string | undefined;

  abstract watchTitle(services: BreadcrumbTitleServices, onTitle: (title: string) => void): () => void;

  static fromView(view: View, variant?: UIVariant): BreadcrumbSource {
    const source = variant === UIVariant.App ? getRowDocumentSourceFromView(view) : null;

    switch (source) {
      case null:
        return new ViewBreadcrumbSource(view);
      default:
        return new DatabaseRowBreadcrumbSource(view.view_id, source);
    }
  }
}

export class ViewBreadcrumbSource extends BreadcrumbSource {
  readonly identity: string;
  readonly initialTitle: string;
  readonly parentViewId: string | undefined;

  constructor(view: View) {
    super();
    this.identity = JSON.stringify(['view', view.view_id, view.name, view.parent_view_id]);
    this.initialTitle = view.name;
    this.parentViewId = view.parent_view_id;
  }

  watchTitle(_services: BreadcrumbTitleServices, onTitle: (title: string) => void): () => void {
    onTitle(this.initialTitle);
    return () => undefined;
  }
}

export class DatabaseRowBreadcrumbSource extends BreadcrumbSource {
  readonly identity: string;
  readonly initialTitle = '';
  readonly parentViewId: string;

  constructor(viewId: string, private readonly source: RowDocumentSourcePayload) {
    super();
    const { database_id, database_view_id, row_id } = source;

    // Folder-name refreshes must not restart a row's primary-cell subscription.
    this.identity = JSON.stringify(['row', viewId, database_id, database_view_id, row_id]);
    // Row documents are detached folder roots; their source supplies the
    // database that belongs in the navigation path.
    this.parentViewId = database_view_id;
  }

  watchTitle(services: BreadcrumbTitleServices, onTitle: (title: string) => void): () => void {
    const { database_id: databaseId, database_view_id: databaseViewId, row_id: rowId } = this.source;
    const { loadView, registerSyncContext, scheduleDeferredCleanup } = services;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    void (async () => {
      try {
        // Metadata and this single row are enough; opening the database UI
        // would unnecessarily load the rest of its rows.
        const [databaseDoc, loadedRowDoc] = await Promise.all([
          loadView(databaseViewId, false, false, { databaseId, databaseMetadataOnly: true }),
          RowService.create(getRowKey(databaseId, rowId)),
        ]);

        if (cancelled || !databaseDoc || !loadedRowDoc) return;

        loadedRowDoc.guid = rowId;
        const rowDoc = registerSyncContext({ doc: loadedRowDoc, collabType: Types.DatabaseRow }).doc;
        const databaseRoot = databaseDoc.getMap(YjsEditorKey.data_section);
        const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);
        const update = () => {
          const database = databaseRoot.get(YjsEditorKey.database) as YDatabase | undefined;
          const fields = database?.get(YjsDatabaseKey.fields);
          const primary = fields && Array.from(fields.entries()).find(([, field]) => field.get(YjsDatabaseKey.is_primary));
          const row = rowRoot.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

          if (!primary || !row) return;

          const [fieldId, field] = primary;
          const cell = row.get(YjsDatabaseKey.cells)?.get(fieldId);

          onTitle(cell ? decodeCellToText(cell, field) : '');
        };

        // Observe the roots too: a cold row can hydrate after sync attaches.
        databaseRoot.observeDeep(update);
        rowRoot.observeDeep(update);
        dispose = () => {
          databaseRoot.unobserveDeep(update);
          rowRoot.unobserveDeep(update);
          scheduleDeferredCleanup(rowId);
        };

        update();
      } catch (error) {
        dispose?.();
        dispose = undefined;
        Log.warn('[breadcrumb] failed to read row title', { rowId, error });
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }
}
