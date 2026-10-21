import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  GalleryCardPreview,
  GalleryCardSize,
  YDatabase,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseGalleryLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

export const DEFAULT_GALLERY_LAYOUT_SETTINGS = {
  showCover: true,
  fitImage: false,
  cardSize: GalleryCardSize.Medium,
  cardWidth: 0,
  cardPreview: GalleryCardPreview.PageCover,
} as const;

export function generateGalleryFieldSettings(
  database: YDatabase,
  fieldOrders: YDatabaseFieldOrders
): YDatabaseFieldSettings {
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const fields = database.get(YjsDatabaseKey.fields);

  if (!fields) return fieldSettings;

  const orderedFieldIds: string[] = [];
  const seen = new Set<string>();

  fieldOrders.toArray().forEach(({ id }) => {
    if (!fields.has(id) || seen.has(id)) return;
    seen.add(id);
    orderedFieldIds.push(id);
  });
  fields.forEach((_, id) => {
    if (seen.has(id)) return;
    seen.add(id);
    orderedFieldIds.push(id);
  });

  orderedFieldIds.forEach((fieldId) => {
    const field = fields.get(fieldId);

    if (!field) return;

    const setting = new Y.Map() as YDatabaseFieldSetting;

    setting.set(
      YjsDatabaseKey.visibility,
      field.get(YjsDatabaseKey.is_primary) ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden
    );
    setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
    fieldSettings.set(fieldId, setting);
  });

  return fieldSettings;
}

export function initializeGalleryLayoutSetting(view: YDatabaseView): YDatabaseGalleryLayoutSetting {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  let gallery = layoutSettings.get('5') as YDatabaseGalleryLayoutSetting | undefined;

  if (!gallery) {
    gallery = new Y.Map() as YDatabaseGalleryLayoutSetting;
    layoutSettings.set('5', gallery);
  }

  if (gallery.get(YjsDatabaseKey.show_cover) === undefined) {
    gallery.set(YjsDatabaseKey.show_cover, DEFAULT_GALLERY_LAYOUT_SETTINGS.showCover);
  }

  if (gallery.get(YjsDatabaseKey.fit_image) === undefined) {
    gallery.set(YjsDatabaseKey.fit_image, DEFAULT_GALLERY_LAYOUT_SETTINGS.fitImage);
  }

  if (gallery.get(YjsDatabaseKey.card_size) === undefined) {
    gallery.set(YjsDatabaseKey.card_size, DEFAULT_GALLERY_LAYOUT_SETTINGS.cardSize);
  }

  if (gallery.get(YjsDatabaseKey.card_width) === undefined) {
    gallery.set(YjsDatabaseKey.card_width, DEFAULT_GALLERY_LAYOUT_SETTINGS.cardWidth);
  }

  if (gallery.get(YjsDatabaseKey.card_preview) === undefined) {
    gallery.set(YjsDatabaseKey.card_preview, DEFAULT_GALLERY_LAYOUT_SETTINGS.cardPreview);
  }

  return gallery;
}

/** Normalize the exact view returned by Cloud into Desktop-compatible Gallery state. */
export function normalizeCreatedDatabaseGalleryView(
  databaseDoc: YDoc,
  preferredViewId: string,
  options: { name?: string } = {}
): string | null {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);

  if (!database || !views) return null;

  let targetViewId = preferredViewId;
  let view = views.get(preferredViewId);

  if (!view?.get(YjsDatabaseKey.field_orders)) {
    const inlineViewId = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid);
    const inlineView = inlineViewId ? views.get(inlineViewId) : undefined;

    if (inlineView?.get(YjsDatabaseKey.field_orders)) {
      targetViewId = inlineViewId;
      view = inlineView;
    }
  }

  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

  if (!view || !fieldOrders) {
    Log.warn('[Gallery creation] database payload has no convertible view', {
      preferredViewId,
      availableViewIds: Array.from(views.keys()).join(','),
    });
    return null;
  }

  databaseDoc.transact(() => {
    const groups = view?.get(YjsDatabaseKey.groups);

    if (groups?.length) groups.delete(0, groups.length);
    view?.set(YjsDatabaseKey.field_settings, generateGalleryFieldSettings(database, fieldOrders));
    initializeGalleryLayoutSetting(view);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Gallery);
    if (options.name) view?.set(YjsDatabaseKey.name, options.name);
  }, 'normalizeCreatedDatabaseGalleryView');

  return targetViewId;
}

export function updateCreatesExactGalleryView(params: {
  databaseId: string;
  existingViewIds: ReadonlySet<string>;
  preRequestState: Uint8Array;
  update: number[];
  viewId: string;
}): boolean {
  if (params.existingViewIds.has(params.viewId)) return false;

  const validationDoc = new Y.Doc();

  try {
    Y.applyUpdate(validationDoc, params.preRequestState);
    Y.applyUpdate(validationDoc, new Uint8Array(params.update));

    const sharedRoot = validationDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(params.viewId);

    return database?.get(YjsDatabaseKey.id) === params.databaseId && Boolean(view?.get(YjsDatabaseKey.field_orders));
  } catch (error) {
    Log.warn('[Gallery creation] failed to validate the Gallery update', {
      viewId: params.viewId,
      error,
    });
    return false;
  } finally {
    validationDoc.destroy();
  }
}
