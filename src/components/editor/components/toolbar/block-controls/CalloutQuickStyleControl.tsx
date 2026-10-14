import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as PaletteIcon } from '@/assets/icons/palette.svg';
import { Origins, Popover } from '@/components/_shared/popover';
import {
  QUICK_STYLE_OPTIONS,
  MORE_STYLE_OPTIONS,
  QuickStyleOption,
  calloutPresetData,
} from '@/components/editor/components/blocks/callout/callout.utils';
import { CalloutGlyph } from '@/components/editor/components/blocks/callout/CalloutGlyph';
import { CalloutNode } from '@/components/editor/editor.type';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { renderColor, toBlockColor } from '@/utils/color';

const popoverOrigins: Origins = {
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
};

const nestedOrigins: Origins = {
  anchorOrigin: {
    vertical: 'center',
    horizontal: 'right',
  },
  transformOrigin: {
    vertical: 'center',
    horizontal: 'left',
  },
};

function CalloutQuickStyleControl({ node, onSelectStyle }: { node: CalloutNode; onSelectStyle: () => void }) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const moreAnchorRef = useRef<HTMLButtonElement>(null);

  const applyStyle = useCallback(
    (option: QuickStyleOption) => {
      CustomEditor.setBlockData(editor, node.blockId, calloutPresetData(option));
      setOpen(false);
      setMoreOpen(false);
      onSelectStyle();
    },
    [editor, node.blockId, onSelectStyle]
  );

  return (
    <>
      <Button
        ref={anchorRef}
        variant='ghost'
        size='sm'
        color='inherit'
        className='justify-start px-1'
        onClick={() => setOpen(true)}
      >
        <PaletteIcon className='h-5 w-5' />
        {t('document.callout.quickStyle')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
      <Popover
        PaperProps={{ className: 'callout-menu-paper' }}
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => {
          setOpen(false);
          setMoreOpen(false);
        }}
        {...popoverOrigins}
      >
        <div className='flex w-[200px] flex-col'>
          <div className='flex flex-col gap-1 p-2'>
            {QUICK_STYLE_OPTIONS.map((option) => {
              const { bg, border, text, icon } = toBlockColor(option.color);

              return (
                <Button
                  key={option.key}
                  size='sm'
                  onClick={() => applyStyle(option)}
                  className='flex h-8 w-full items-center justify-start rounded-[8px] border border-transparent px-2 py-1.5 text-left hover:border-[var(--dynamic-border-color)] focus-visible:border-[var(--dynamic-border-color)]'
                  style={
                    {
                      background: renderColor(bg),
                      color: renderColor(text),
                      '--dynamic-border-color': renderColor(border),
                    } as React.CSSProperties
                  }
                >
                  <div className='flex h-5 w-5 items-center justify-center'>
                    <CalloutGlyph id={`${option.iconGroup}/${option.iconName}`} color={icon} />
                  </div>
                  <span className='text-sm font-normal'>{t(option.labelKey)}</span>
                </Button>
              );
            })}
          </div>
          <Separator className='mt-2' />
          <Button
            ref={moreAnchorRef}
            size='sm'
            variant='ghost'
            className='m-2 justify-start px-2 py-1.5'
            onClick={() => setMoreOpen((prev) => !prev)}
          >
            <PaletteIcon className='h-5 w-5' />
            {t('document.callout.moreStyles')}
            <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
          </Button>
        </div>
      </Popover>
      <Popover
        PaperProps={{ className: 'callout-menu-paper' }}
        open={moreOpen}
        anchorEl={moreAnchorRef.current}
        onClose={() => setMoreOpen(false)}
        {...nestedOrigins}
      >
        <div className='flex w-[200px] flex-col gap-1 p-2'>
          {MORE_STYLE_OPTIONS.map((option) => {
            const { bg, border, text, icon } = toBlockColor(option.color);

            return (
              <Button
                key={option.key}
                onClick={() => applyStyle(option)}
                size='sm'
                className='flex h-8 w-full items-center justify-start rounded-[8px] border border-transparent px-2 py-1.5 text-left hover:border-[var(--dynamic-border-color)] focus-visible:border-[var(--dynamic-border-color)]'
                style={
                  {
                    background: renderColor(bg),
                    color: renderColor(text),
                    '--dynamic-border-color': renderColor(border),
                  } as React.CSSProperties
                }
              >
                <div className='flex h-5 w-5 items-center justify-center'>
                  <CalloutGlyph id={`${option.iconGroup}/${option.iconName}`} color={icon} />
                </div>
                <span className='text-sm font-normal'>{t(option.labelKey)}</span>
              </Button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export default CalloutQuickStyleControl;
