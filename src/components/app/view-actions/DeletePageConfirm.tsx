import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { NormalModal } from '@/components/_shared/modal';
import { filterViewsByCondition } from '@/components/_shared/outline/utils';
import { useAppOperations, useAppView } from '@/components/app/app.hooks';

function DeletePageConfirm({
  open,
  onClose,
  viewId,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  viewId: string;
  onDeleted?: () => void;
}) {
  const view = useAppView(viewId);
  const [loading, setLoading] = React.useState(false);
  const { deletePage } = useAppOperations();
  const { t } = useTranslation();

  const handleOk = useCallback(async () => {
    if (!view) return;
    setLoading(true);
    try {
      await deletePage?.(viewId);
      onClose();
      onDeleted?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [deletePage, onClose, onDeleted, view, viewId]);

  const hasPublished = useMemo(() => {
    const publishedView = filterViewsByCondition(view?.children || [], (v) => v.is_published);

    return view?.is_published || !!publishedView.length;
  }, [view]);

  useEffect(() => {
    if (!hasPublished && open) {
      void handleOk();
    }
  }, [handleOk, hasPublished, open]);

  if (!hasPublished) return null;

  return (
    <NormalModal
      data-testid="delete-page-confirm-modal"
      okLoading={loading}
      keepMounted={false}
      disableRestoreFocus={true}
      okText={t('button.delete')}
      cancelText={t('button.cancel')}
      open={open}
      danger={true}
      onClose={onClose}
      title={
        <div className={'flex w-full items-center text-left font-semibold'}>
          <span className={'w-full truncate'}>{`${t('button.delete')}: ${view?.name}`}</span>
        </div>
      }
      onOk={handleOk}
      PaperProps={{
        className: 'w-[420px] max-w-[70vw]',
      }}
    >
      <div className={'font-normal text-text-secondary'}>{t('publish.containsPublishedPage')}</div>
    </NormalModal>
  );
}

export default DeletePageConfirm;
