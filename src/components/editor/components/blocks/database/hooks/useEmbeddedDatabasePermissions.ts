import {
  Types,
  UIVariant,
  type YDoc,
  type YSharedRoot,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

interface UseEmbeddedDatabasePermissionsParams {
  sourceViewId: string;
  sourceDatabaseId?: string;
  variant?: UIVariant;
  publishReadOnly: boolean;
  publishCanWrite?: boolean;
  publishCanShare?: boolean;
}

/** Resolve the canonical database collab for both current and legacy blocks. */
export function resolveEmbeddedDatabaseCollabId(
  explicitDatabaseId: string | undefined,
  doc: YDoc | null
): string | undefined {
  if (explicitDatabaseId) return explicitDatabaseId;
  if (!doc) return undefined;

  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
    const database = sharedRoot?.get(YjsEditorKey.database);
    const databaseId = database?.get(YjsDatabaseKey.id);

    if (typeof databaseId === 'string' && databaseId.length > 0) return databaseId;
  } catch {
    // A legacy collab can predate the inner ID; its Y.Doc guid is the object
    // identity used by the loader and sync layer.
  }

  return doc.guid || undefined;
}

/**
 * Resolve data-source permissions independently from the document containing
 * the linked database block. App embeds fail closed until the source database
 * collab permission has been validated. Published embeds retain the static
 * editor permissions supplied by the publish renderer.
 */
export function useEmbeddedDatabasePermissions({
  sourceViewId,
  sourceDatabaseId,
  variant,
  publishReadOnly,
  publishCanWrite,
  publishCanShare,
}: UseEmbeddedDatabasePermissionsParams) {
  const isPublishVariant = variant === UIVariant.Publish;
  const shouldLoadSourcePermissions = !isPublishVariant && Boolean(sourceViewId && sourceDatabaseId);
  const sourcePermissions = useViewActionPermissions(
    null,
    shouldLoadSourcePermissions,
    sourceViewId,
    sourceDatabaseId
      ? { collabObjectId: sourceDatabaseId, collabType: Types.Database }
      : undefined
  );

  if (isPublishVariant) {
    return {
      readOnly: publishReadOnly,
      canWrite: publishCanWrite ?? !publishReadOnly,
      canShare: publishCanShare ?? false,
    };
  }

  return {
    readOnly: !sourcePermissions.canWrite,
    canWrite: sourcePermissions.canWrite,
    canShare: sourcePermissions.canShare,
  };
}
