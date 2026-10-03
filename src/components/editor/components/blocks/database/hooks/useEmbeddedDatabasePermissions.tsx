import { Types, UIVariant, type YDoc, type YSharedRoot, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import type { ReactElement } from 'react';

interface EmbeddedDatabasePermissionsParams {
  sourceViewId: string;
  sourceDatabaseId?: string;
  variant?: UIVariant;
  /** UI restriction imposed by the containing editor, including page locks. */
  inheritedReadOnly: boolean;
  publishCanWrite?: boolean;
  publishCanShare?: boolean;
}

export interface EmbeddedDatabasePermissions {
  readOnly: boolean;
  canWrite: boolean;
  canShare: boolean;
}

/** Whether the source permission request has answered; until then the permissions fail closed. */
export interface EmbeddedDatabasePermissionsStatus {
  settled: boolean;
}

type EmbeddedDatabasePermissionsRenderer = (
  permissions: EmbeddedDatabasePermissions,
  status: EmbeddedDatabasePermissionsStatus
) => ReactElement | null;

interface EmbeddedDatabasePermissionsResolverProps extends EmbeddedDatabasePermissionsParams {
  children: EmbeddedDatabasePermissionsRenderer;
}

interface AppEmbeddedDatabasePermissionsResolverProps {
  sourceViewId: string;
  sourceDatabaseId?: string;
  inheritedReadOnly: boolean;
  children?: EmbeddedDatabasePermissionsRenderer;
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

type AppEmbeddedDatabasePermissionsParams = Pick<
  EmbeddedDatabasePermissionsParams,
  'sourceViewId' | 'sourceDatabaseId' | 'inheritedReadOnly'
>;

function useAppEmbeddedDatabasePermissionsWithStatus({
  sourceViewId,
  sourceDatabaseId,
  inheritedReadOnly,
}: AppEmbeddedDatabasePermissionsParams): EmbeddedDatabasePermissionsStatus & {
  permissions: EmbeddedDatabasePermissions;
} {
  const shouldLoadSourcePermissions = Boolean(sourceViewId && sourceDatabaseId);
  const sourcePermissions = useViewActionPermissions(
    null,
    shouldLoadSourcePermissions,
    sourceViewId,
    sourceDatabaseId ? { collabObjectId: sourceDatabaseId, collabType: Types.Database } : undefined
  );

  return {
    permissions: {
      readOnly: inheritedReadOnly || !sourcePermissions.canWrite,
      canWrite: sourcePermissions.canWrite,
      canShare: sourcePermissions.canShare,
    },
    settled: sourcePermissions.hasLoadedViewActionPermissions,
  };
}

/** Resolve and fail closed on an app embed until its source permission is known. */
export function useAppEmbeddedDatabasePermissions(
  params: AppEmbeddedDatabasePermissionsParams
): EmbeddedDatabasePermissions {
  return useAppEmbeddedDatabasePermissionsWithStatus(params).permissions;
}

function AppEmbeddedDatabasePermissionsResolver({
  sourceViewId,
  sourceDatabaseId,
  inheritedReadOnly,
  children,
}: AppEmbeddedDatabasePermissionsResolverProps) {
  const { permissions, settled } = useAppEmbeddedDatabasePermissionsWithStatus({
    sourceViewId,
    sourceDatabaseId,
    inheritedReadOnly,
  });

  return children?.(permissions, { settled }) ?? null;
}

/**
 * Keep publish rendering outside the authenticated permission-hook tree. The
 * app-only child component provides a stable hook boundary if the variant
 * changes at runtime.
 */
export function EmbeddedDatabasePermissionsResolver({
  sourceViewId,
  sourceDatabaseId,
  variant,
  inheritedReadOnly,
  publishCanWrite,
  publishCanShare,
  children,
}: EmbeddedDatabasePermissionsResolverProps): ReactElement | null {
  if (variant === UIVariant.Publish) {
    return children(
      {
        readOnly: inheritedReadOnly,
        canWrite: publishCanWrite ?? !inheritedReadOnly,
        canShare: publishCanShare ?? false,
      },
      { settled: true }
    );
  }

  return (
    <AppEmbeddedDatabasePermissionsResolver
      sourceViewId={sourceViewId}
      sourceDatabaseId={sourceDatabaseId}
      inheritedReadOnly={inheritedReadOnly}
    >
      {children}
    </AppEmbeddedDatabasePermissionsResolver>
  );
}
