import React, { SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react';
import SwipeableViews from 'react-swipeable-views';

import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export enum TAB_KEY {
  Colors = 'colors',
  UPLOAD = 'upload',
  EMBED_LINK = 'embed_link',
  UNSPLASH = 'unsplash',
}

export type TabOption = {
  key: TAB_KEY;
  label: string;
  Component: React.ComponentType<{
    onDone?: (value: string) => void;
    onEscape?: () => void;
    uploadAction?: (file: File) => Promise<string>;
  }>;
  onDone?: (value: string) => void;
  uploadAction?: (file: File) => Promise<string>;
};

export function UploadPopover({
  tabOptions,
  extra,
  children,
  open = false,
  onOpenChange,
}: {
  containerStyle?: React.CSSProperties;
  tabOptions: TabOption[];
  extra?: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [tabValue, setTabValue] = useState<TAB_KEY>(() => {
    return tabOptions[0].key;
  });

  const handleTabChange = useCallback((_: SyntheticEvent, newValue: string) => {
    setTabValue(newValue as TAB_KEY);
  }, []);

  const selectedIndex = tabOptions.findIndex((tab) => tab.key === tabValue);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        setTabValue((prev) => {
          const currentIndex = tabOptions.findIndex((tab) => tab.key === prev);
          let nextIndex = currentIndex + 1;

          if (e.shiftKey) {
            nextIndex = currentIndex - 1;
          }

          return tabOptions[nextIndex % tabOptions.length]?.key ?? tabOptions[0].key;
        });
      }
    },
    [tabOptions]
  );

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;

    if (!el) return;

    const handleResize = () => {
      const top = el.getBoundingClientRect().top;
      const height = window.innerHeight - top - 20;

      el.style.maxHeight = `${height}px`;
    };

    if (tabValue === 'unsplash') {
      handleResize();
    }
  }, [tabValue]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onKeyDown={onKeyDown}
        className={'flex w-[400px] flex-col overflow-hidden max-md:min-w-full'}
      >
        <div className={'flex items-center justify-start gap-2 border-b border-border-primary pt-1 mx-4'}>
          <ViewTabs
            value={tabValue}
            onChange={handleTabChange}
            scrollButtons={false}
            variant='scrollable'
            allowScrollButtonsMobile
            className={'min-h-[38px]'}
          >
            {tabOptions.map((tab) => {
              const { key, label } = tab;

              return <ViewTab key={key} iconPosition='start' color='inherit' label={label} value={key} />;
            })}
          </ViewTabs>
          {extra}
        </div>

        <div ref={ref} className={'appflowy-scroller h-full w-full flex-1 overflow-y-auto overflow-x-hidden'}>
          <SwipeableViews
            slideStyle={{
              overflow: 'hidden',
              height: '100%',
            }}
            axis={'x'}
            index={selectedIndex}
          >
            {tabOptions.map((tab, index) => {
              const { key, Component, onDone } = tab;

              return (
                <TabPanel className={'flex h-full w-full flex-col px-4 py-3'} key={key} index={index} value={selectedIndex}>
                  <Component onDone={onDone} uploadAction={tab.uploadAction} onEscape={() => onOpenChange?.(false)} />
                </TabPanel>
              );
            })}
          </SwipeableViews>
        </div>
      </PopoverContent>
    </Popover>
  );
}
