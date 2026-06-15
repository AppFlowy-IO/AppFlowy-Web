import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewIconType } from '@/application/types';
import { EmojiPicker } from '@/components/_shared/emoji-picker';
import IconPicker from '@/components/_shared/icon-picker/IconPicker';
import { UploadImage } from '@/components/_shared/image-upload';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  TabLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export function CustomIconPopover ({
  open,
  onOpenChange,
  children,
  enable = true,
  tabs = ['emoji', 'icon', 'upload'],
  defaultActiveTab = 'emoji',
  removeIcon,
  hideRemove,
  onSelectIcon,
  enableColor = true,
  onUploadFile,
  popoverContentProps,
  ...props
}: {
  enable?: boolean;
  enableColor?: boolean,
  children: React.ReactNode;
  defaultActiveTab?: 'emoji' | 'icon' | 'upload';
  tabs?: ('emoji' | 'icon' | 'upload')[];
  removeIcon?: () => void,
  hideRemove?: boolean,
  onSelectIcon?: (icon: { ty: ViewIconType, value: string, color?: string, content?: string }) => void,
  onUploadFile?: (file: File) => Promise<string>,
} & React.ComponentProps<typeof Popover> & {
  popoverContentProps?: React.ComponentProps<typeof PopoverContent>
}) {
  const { t } = useTranslation();
  const [tabValue, setTabValue] = useState<string>(defaultActiveTab);
  const [
    openState,
    setOpen,
  ] = useState<boolean>(open ?? false);

  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    onOpenChange?.(open);
  };

  useEffect(() => {
    if (open !== undefined) {
      setOpen(open);
      onOpenChange?.(open);
    }
  }, [onOpenChange, open]);

  const handleClose = () => {
    setOpen(false);
  };

  if (!enable) return <>{children}</>;

  return (
    <Popover {...props} open={openState} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={'bottom'}
        align={'start'}
        className='w-[402px]'
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
        }}
        {...popoverContentProps}
      >
        <Tabs
          value={tabValue}
          onValueChange={setTabValue}
          defaultValue={defaultActiveTab}
          className='flex flex-col gap-3'
        >
          <div className='flex  items-center justify-between gap-3 border-b border-border-primary px-3'>
            <TabsList className='mt-2 flex w-full flex-1 justify-start'>
              {tabs.map((tab) => (
                <TabsTrigger key={tab} value={tab} data-testid={`icon-popover-tab-${tab}`}>
                  <TabLabel>{tab.charAt(0).toUpperCase() + tab.slice(1)}</TabLabel>
                </TabsTrigger>
              ))}
            </TabsList>
            {!hideRemove && (
              <Button
                className={'text-text-secondary'}
                variant={'ghost'}
                onClick={() => {
                  removeIcon?.();
                }}
              >
                {t('button.remove')}
              </Button>
            )}
          </div>

          <TabsContent value='emoji'>
            <EmojiPicker
              size={[400, 360]}
              onEmojiSelect={(emoji: string) => {
                onSelectIcon?.({
                  ty: ViewIconType.Emoji,
                  value: emoji,
                });
                handleClose();
              }}
            />
          </TabsContent>
          <TabsContent value='icon'>
            <IconPicker
              enableColor={enableColor}
              size={[400, 360]}
              onEscape={handleClose}
              onSelect={(icon) => {
                onSelectIcon?.({
                  ty: ViewIconType.Icon,
                  ...icon,
                });
                handleClose();
              }}
              container={popoverContentProps?.container as HTMLDivElement}
            />
          </TabsContent>
          <TabsContent value='upload'>
            <div className={'flex h-[360px] w-full flex-col px-3 pb-3'}>
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
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

export default CustomIconPopover;