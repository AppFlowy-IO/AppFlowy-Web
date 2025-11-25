import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';

import { DatabaseContextState } from '@/application/database-yjs';
import { LoadView, LoadViewMeta, UIVariant, YDoc } from '@/application/types';
import { Database } from '@/components/database';

interface DatabaseContentProps {
  selectedViewId: string | null;
  hasDatabase: boolean;
  notFound: boolean;
  paddingStart: number;
  paddingEnd: number;
  width: number;
  doc: YDoc | null;
  workspaceId: string;
  viewId: string;
  createRowDoc?: (rowId: string) => Promise<YDoc>;
  loadView?: LoadView;
  navigateToView?: (viewId: string, rowId?: string) => Promise<void>;
  onOpenRowPage: (rowId: string) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  iidName: string;
  visibleViewIds: string[];
  onChangeView: (viewId: string) => void;
  context: DatabaseContextState;
  fixedHeight?: number;
  onRendered?: () => void;
}

export const DatabaseContent = ({
  selectedViewId,
  hasDatabase,
  notFound,
  paddingStart,
  paddingEnd,
  width,
  doc,
  workspaceId,
  viewId: _viewId,
  createRowDoc,
  loadView,
  navigateToView,
  onOpenRowPage,
  loadViewMeta,
  iidName,
  visibleViewIds,
  onChangeView,
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
          iidIndex={selectedViewId}
          viewId={selectedViewId}
          createRowDoc={createRowDoc}
          loadView={loadView}
          navigateToView={navigateToView}
          onOpenRowPage={onOpenRowPage}
          loadViewMeta={loadViewMeta}
          iidName={iidName}
          visibleViewIds={visibleViewIds}
          onChangeView={onChangeView}
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
