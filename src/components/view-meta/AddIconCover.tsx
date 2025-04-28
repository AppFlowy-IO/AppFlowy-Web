import { ViewIconType } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ReactComponent as AddIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as AddCover } from '@/assets/icons/image.svg';

function AddIconCover ({
  hasIcon,
  hasCover,
  onUpdateIcon,
  onAddCover,
  maxWidth,
  visible,
  onUploadFile,
}: {
  visible: boolean;
  hasIcon: boolean;
  hasCover: boolean;
  onUpdateIcon?: (icon: { ty: ViewIconType, value: string }) => void;
  onAddCover?: () => void;
  maxWidth?: number;
  onUploadFile: (file: File) => Promise<string>;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div
        style={{
          width: maxWidth ? `${maxWidth}px` : '100%',
          visibility: visible ? 'visible' : 'hidden',
        }}
        className={'max-sm:px-6 px-24 flex items-end min-w-0 max-w-full gap-2 justify-start max-sm:hidden'}
      >
        {!hasIcon && <CustomIconPopover
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
        ><Button
          color={'inherit'}
          size={'small'}
          startIcon={<AddIcon />}
        >{t('document.plugins.cover.addIcon')}</Button></CustomIconPopover>}
        {!hasCover && <Button
          size={'small'}
          color={'inherit'}
          onClick={onAddCover}
          startIcon={<AddCover />}
        >{t('document.plugins.cover.addCover')}</Button>}

      </div>

    </>

  );
}

export default AddIconCover;