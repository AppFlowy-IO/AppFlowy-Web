import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { ViewIconType } from '@/application/types';
import { ReactComponent as AddIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as AddCover } from '@/assets/icons/image.svg';
import { ReactComponent as SmileIcon } from '@/assets/icons/smile.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { cn } from '@/lib/utils';

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
  variant = 'default',
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
  variant?: 'default' | 'peek';
}) {
  const { t } = useTranslation();
  const addCover = !hasCover ? (
    <Button size='small' color='inherit' onClick={onAddCover} startIcon={<AddCover />}>
      {t('document.plugins.cover.addCover')}
    </Button>
  ) : null;

  return (
    <div
      style={{
        width: maxWidth ? `${maxWidth}px` : '100%',
        visibility: visible ? 'visible' : 'hidden',
      }}
      className={cn(
        'flex h-full min-w-0 max-w-full items-end justify-start gap-2 px-24 max-sm:hidden max-sm:px-6',
        variant === 'peek' && 'row-peek-banner-controls',
        contentClassName
      )}
    >
      {variant === 'peek' ? addCover : null}
      {!hasIcon && (
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
          <Button
            data-testid='add-icon-button'
            color='inherit'
            size='small'
            startIcon={variant === 'peek' ? <SmileIcon /> : <AddIcon />}
          >
            {t('document.plugins.cover.addIcon')}
          </Button>
        </CustomIconPopover>
      )}
      {variant === 'default' ? addCover : null}
    </div>
  );
}

export default AddIconCover;
