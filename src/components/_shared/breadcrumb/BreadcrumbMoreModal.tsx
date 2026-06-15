import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { UIVariant, View } from '@/application/types';
import BreadcrumbItem from '@/components/_shared/breadcrumb/BreadcrumbItem';
import { NormalModal } from '@/components/_shared/modal';

function BreadcrumbMoreModal({
  open,
  onClose,
  crumbs,
  toView,
  variant,
}: {
  open: boolean;
  onClose: () => void;
  crumbs: View[];
  toView?: (viewId: string) => Promise<void>;
  variant?: UIVariant;
}) {
  const { t } = useTranslation();
  const title = useMemo(() => {
    return (
      <div className={'flex items-center gap-2'}>
        <div className={'flex-1 text-center font-semibold'}>{t('breadcrumbs.label')}</div>
      </div>
    );
  }, [t]);

  return (
    <NormalModal
      title={title}
      okButtonProps={{
        className: 'hidden',
      }}
      cancelButtonProps={{
        className: 'hidden',
      }}
      open={open}
      onClose={onClose}
    >
      <div className={'flex min-w-[350px] flex-col justify-start gap-2 max-sm:min-w-full'}>
        {crumbs.map((crumb, index) => (
          <div
            key={crumb.view_id}
            onClick={() => {
              if (index === 0) return;
              onClose();
            }}
            className={`flex items-center gap-2 ${
              index !== 0 ? 'cursor-pointer hover:bg-fill-content-hover' : ''
            } rounded-[8px] py-1.5`}
            style={{
              paddingLeft: (index + 1) * 16,
            }}
          >
            {index !== 0 && <div className={'text-text-secondary'}> {'-'} </div>}
            <BreadcrumbItem crumb={crumb} toView={toView} variant={variant} />
          </div>
        ))}
      </div>
    </NormalModal>
  );
}

export default BreadcrumbMoreModal;
