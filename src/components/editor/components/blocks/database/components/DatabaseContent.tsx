import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';

import { DatabaseContextState } from '@/application/database-yjs';
import { LoadView, LoadViewMeta, UIVariant, YDoc } from '@/application/types';
import { Database } from '@/components/database';

interface DatabaseContentProps {
  /**
   * The base/primary view ID for the embedded database.
   * This is the first view that was embedded and remains constant.
   */
  baseViewId: string;
  /**
   * The currently selected/active view tab ID.
   * Changes when user switches between different view tabs.
   */
  selectedViewId: string | null;
  hasDatabase: boolean;
  notFound: boolean;
  paddingStart: number;
  paddingEnd: number;
  width: number;
  doc: YDoc | null;
  workspaceId: string;
  createRow?: (rowId: string) => Promise<YDoc>;
  loadView?: LoadView;
  navigateToView?: (viewId: string, rowId?: string) => Promise<void>;
  onOpenRowPage: (rowId: string) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  databaseName: string;
  visibleViewIds: string[];
  onChangeView: (viewId: string) => void;
  onViewAdded?: (viewId: string) => void;
  onViewIdsChanged?: (viewIds: string[]) => void;
  context: DatabaseContextState;
  fixedHeight?: number;
  onRendered?: () => void;
}

export const DatabaseContent = ({
  baseViewId,
  selectedViewId,
  hasDatabase,
  notFound,
  paddingStart,
  paddingEnd,
  width,
  doc,
  workspaceId,
  createRow,
  loadView,
  navigateToView,
  onOpenRowPage,
  loadViewMeta,
  databaseName,
  visibleViewIds,
  onChangeView,
  onViewAdded,
  onViewIdsChanged,
  context,
  fixedHeight,
  onRendered,
}: DatabaseContentProps) => {
  const { t } = useTranslation();
  const isPublishVarient = context?.variant === UIVariant.Publish;

  if (selectedViewId && doc && hasDatabase && !notFound) {
    return (
      <div
        className={'relative'}
        style={{
          left: `-${paddingStart}px`,
          width,
        }}
      >
          <Database
            {...context}
            workspaceId={workspaceId}
            doc={doc}
            databasePageId={baseViewId}
            activeViewId={selectedViewId}
            createRow={createRow}
            loadView={loadView}
            navigateToView={navigateToView}
            onOpenRowPage={onOpenRowPage}
            loadViewMeta={loadViewMeta}
            databaseName={databaseName}
            visibleViewIds={visibleViewIds}
            onChangeView={onChangeView}
            onViewAdded={onViewAdded}
            onViewIdsChanged={onViewIdsChanged}
            showActions={true}
            paddingStart={paddingStart}
            paddingEnd={paddingEnd}
            isDocumentBlock={true}
            embeddedHeight={fixedHeight}
            onRendered={onRendered}
          />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded bg-background-primary px-16 py-10 text-text-secondary max-md:px-4">
      {notFound ? (
        <div className="text-base font-medium">
          {isPublishVarient ? t('publish.hasNotBeenPublished') : t('error.generalError')}
        </div>
      ) : (
        <CircularProgress size={20} />
      )}
    </div>
  );
};
