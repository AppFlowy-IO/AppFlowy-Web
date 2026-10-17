import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewIconType } from '@/application/types';
import { ReactComponent as AddIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as AddCover } from '@/assets/icons/image.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { cn } from '@/lib/utils';

import HeaderToolbarButton from './HeaderToolbarButton';

function AddIconCover({
  hasIcon,
  hasCover,
  onUpdateIcon,
  onAddCover,
  maxWidth,
  visible,
  onUploadFile,
  iconTabs,
  defaultIconTab,
  contentClassName,
  readOnly = false,
  children,
}: {
  visible: boolean;
  hasIcon: boolean;
  hasCover: boolean;
  onUpdateIcon?: (icon: { ty: ViewIconType; value: string }) => void;
  onAddCover?: () => void;
  maxWidth?: number;
  onUploadFile: (file: File) => Promise<string>;
  iconTabs?: ['emoji' | 'icon' | 'upload'];
  defaultIconTab?: 'emoji' | 'icon' | 'upload';
  contentClassName?: string;
  readOnly?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        width: maxWidth ? `${maxWidth}px` : '100%',
      }}
      className={cn(
        'flex h-full min-w-0 max-w-full items-end justify-start gap-2 px-24 max-sm:px-6',
        !children && 'max-sm:hidden',
        contentClassName
      )}
    >
      {!readOnly && !hasIcon && (
        <CustomIconPopover
          tabs={iconTabs}
          defaultActiveTab={defaultIconTab}
          onSelectIcon={(icon) => {
            if (icon.ty === ViewIconType.Icon) {
              onUpdateIcon?.({
                ty: ViewIconType.Icon,
                value: JSON.stringify({
                  color: icon.color,
                  groupName: icon.value.split('/')[0],
                  iconName: icon.value.split('/')[1],
                }),
              });
              return;
            }

            onUpdateIcon?.(icon);
          }}
          removeIcon={() => {
            onUpdateIcon?.({ ty: ViewIconType.Emoji, value: '' });
          }}
          onUploadFile={onUploadFile}
        >
          <HeaderToolbarButton className={cn('max-sm:!hidden', !visible && 'invisible')} data-testid='add-icon-button'>
            <AddIcon className='h-5 w-5 text-icon-primary' />
            {t('document.plugins.cover.addIcon')}
          </HeaderToolbarButton>
        </CustomIconPopover>
      )}
      {!readOnly && !hasCover && (
        <HeaderToolbarButton className={cn('max-sm:!hidden', !visible && 'invisible')} onClick={onAddCover}>
          <AddCover className='h-5 w-5 text-icon-primary' />
          {t('document.plugins.cover.addCover')}
        </HeaderToolbarButton>
      )}
      {children && <div className='flex items-center'>{children}</div>}
    </div>
  );
}

export default AddIconCover;
