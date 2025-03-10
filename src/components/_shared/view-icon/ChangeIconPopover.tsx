import { ViewIconType } from '@/application/types';
import { EmojiPicker } from '@/components/_shared/emoji-picker';
import IconPicker from '@/components/_shared/icon-picker/IconPicker';
import { UploadImage } from '@/components/_shared/image-upload';
import { Popover } from '@/components/_shared/popover';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { Button } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

function ChangeIconPopover({
  open,
  anchorEl,
  onClose,
  defaultType,
  emojiEnabled = true,
  iconEnabled = true,
  popoverProps = {},
  onSelectIcon,
  removeIcon,
  anchorPosition,
  hideRemove,
  uploadEnabled,
  onUploadFile,
}: {
  open: boolean,
  anchorEl?: HTMLElement | null,
  anchorPosition?: PopoverProps['anchorPosition'],
  onClose: () => void,
  defaultType: 'emoji' | 'icon' | 'upload',
  emojiEnabled?: boolean,
  uploadEnabled?: boolean,
  iconEnabled?: boolean,
  popoverProps?: Partial<PopoverProps>,
  onSelectIcon?: (icon: { ty: ViewIconType, value: string, color?: string, content?: string }) => void,
  onUploadFile?: (file: File) => Promise<string>,
  removeIcon?: () => void,
  hideRemove?: boolean,
}) {
  const [value, setValue] = useState(defaultType);
  const { t } = useTranslation();

  const handleClose = () => {
    onClose();
    setValue(defaultType);
  };

  return (
    <Popover
      onClose={handleClose}
      open={open}
      anchorEl={anchorEl}
      {...popoverProps}
      anchorPosition={anchorPosition}
      anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
    >
      <div
        data-testid="change-icon-popover"
        className={'border-b w-[402px] border-line-divider px-4 pt-2 flex items-center justify-between'}
      >
        <ViewTabs
          onChange={(_e, newValue) => setValue(newValue)}
          value={value}
          className={'flex-1 mb-[-2px]'}
        >

          {
            emojiEnabled && (
              <ViewTab
                className={'flex items-center flex-row justify-center gap-1.5'}
                value={'emoji'}
                label={'Emojis'}
                data-testid="emoji-tab"
              />
            )
          }
          {
            iconEnabled && (
              <ViewTab
                className={'flex items-center flex-row justify-center gap-1.5'}
                value={'icon'}
                label={'Icons'}
                data-testid="icon-tab"
              />
            )
          }
          {
            uploadEnabled && (
              <ViewTab
                className={'flex items-center flex-row justify-center gap-1.5'}
                value={'upload'}
                label={'Upload'}
                data-testid="upload-tab"
              />
            )
          }

        </ViewTabs>
        {!hideRemove && <Button
          variant={'text'}
          color={'inherit'}
          size={'small'}
          className={'p-1 h-auto min-h-fit'}
          onClick={() => {
            removeIcon?.();
          }}
        >
          {t('button.remove')}
        </Button>}

      </div>

      {iconEnabled && <TabPanel
        index={'icon'}
        value={value}
      >
        <IconPicker
          size={[400, 360]}
          onEscape={handleClose}
          onSelect={(icon) => {
            onSelectIcon?.({
              ty: ViewIconType.Icon,
              ...icon,
            });
            handleClose();
          }}
        />
      </TabPanel>}
      {emojiEnabled && <TabPanel
        index={'emoji'}
        value={value}
      >
        <EmojiPicker
          size={[400, 360]}
          onEmojiSelect={(emoji: string) => {
            onSelectIcon?.({
              ty: ViewIconType.Emoji,
              value: emoji,
            });
          }}
          onEscape={handleClose}
          hideRemove
        />
      </TabPanel>}
      {uploadEnabled && <TabPanel
        index={'upload'}
        value={value}
      >
        <div
          style={{
            width: 400,
            height: 360,
          }}
          className={'relative pt-4 pb-2'}
        >
          <UploadImage
            onDone={(url) => {
              onSelectIcon?.({
                ty: ViewIconType.URL,
                value: url,
              });
              handleClose();
            }}
            uploadAction={onUploadFile}
          />
        </div>

      </TabPanel>}
    </Popover>
  );
}

export default ChangeIconPopover;