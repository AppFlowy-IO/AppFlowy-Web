import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ColorTile } from '@/components/_shared/color-picker';
import { Origins, Popover } from '@/components/_shared/popover';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { calloutPaletteTextColor, toCalloutColor } from '@/components/editor/components/blocks/callout/callout.utils';
import { CalloutNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ColorEnum, renderColor, toTint } from '@/utils/color';

const origins: Origins = {
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
};

function TextColorPreview({ color }: { color: string }) {
  return (
    <div
      aria-hidden='true'
      className='m-0.5 flex h-4 w-4 items-center justify-center rounded-[4px] border border-border-primary'
    >
      <span className='text-[11px] leading-none' style={{ color }}>
        A
      </span>
    </div>
  );
}

function CalloutTextColor({ node, onSelectColor }: { node: CalloutNode; onSelectColor: () => void }) {
  const { getSubscriptions, workspaceId } = useEditorContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const blockId = node.blockId;
  const selectedColor = (node.data?.textColor || node.data?.bgColor || ColorEnum.Tint10) as ColorEnum;

  const { isPro } = useSubscriptionPlan(getSubscriptions, {
    cacheKey: workspaceId ? `block-colors:${workspaceId}` : undefined,
    enabled: open,
  });

  const builtinColors = useMemo(() => {
    const proPalette = [
      { color: ColorEnum.BlockTextColor14, label: t('colors.mauve') },
      { color: ColorEnum.BlockTextColor15, label: t('colors.lavender') },
      { color: ColorEnum.BlockTextColor16, label: t('colors.lilac') },
      { color: ColorEnum.BlockTextColor17, label: t('colors.mallow') },
      { color: ColorEnum.BlockTextColor18, label: t('colors.camellia') },
      { color: ColorEnum.BlockTextColor1, label: t('colors.rose') },
      { color: ColorEnum.BlockTextColor2, label: t('colors.papaya') },
      { color: ColorEnum.BlockTextColor4, label: t('colors.mango') },
      { color: ColorEnum.BlockTextColor5, label: t('colors.lemon') },
      { color: ColorEnum.BlockTextColor6, label: t('colors.olive') },
      { color: ColorEnum.BlockTextColor8, label: t('colors.grass') },
      { color: ColorEnum.BlockTextColor10, label: t('colors.jade') },
      { color: ColorEnum.BlockTextColor12, label: t('colors.azure') },
    ];

    const freePalette = [
      { color: ColorEnum.BlockTextColor14, label: t('colors.mauve') },
      { color: ColorEnum.BlockTextColor16, label: t('colors.lilac') },
      { color: ColorEnum.BlockTextColor18, label: t('colors.camellia') },
      { color: ColorEnum.BlockTextColor2, label: t('colors.papaya') },
      { color: ColorEnum.BlockTextColor4, label: t('colors.mango') },
      { color: ColorEnum.BlockTextColor6, label: t('colors.olive') },
      { color: ColorEnum.BlockTextColor8, label: t('colors.grass') },
      { color: ColorEnum.BlockTextColor10, label: t('colors.jade') },
      { color: ColorEnum.BlockTextColor12, label: t('colors.azure') },
    ];

    return [
      {
        color: ColorEnum.BlockTextColor20,
        label: t('colors.default'),
      },
      ...(isPro ? proPalette : freePalette),
    ];
  }, [isPro, t]);

  const { text: previewColor } = useMemo(() => {
    return toCalloutColor(selectedColor);
  }, [selectedColor]);

  const handlePickColor = useCallback(
    (color: string) => {
      CustomEditor.setBlockData(editor, blockId, { textColor: toTint(color as ColorEnum) });
    },
    [blockId, editor]
  );

  return (
    <>
      <Button
        ref={ref}
        size='sm'
        variant='ghost'
        className={'justify-start px-1'}
        onClick={() => {
          setOpen(true);
        }}
      >
        <TextColorPreview color={renderColor(previewColor)} />
        {t('editor.textColor')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
      <Popover
        PaperProps={{ className: 'callout-menu-paper' }}
        open={open}
        anchorEl={ref.current}
        onClose={() => setOpen(false)}
        {...origins}
      >
        <div className='flex w-[200px] flex-col py-1.5'>
          <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>{t('editor.textColor')}</div>
          <div className={'flex flex-wrap gap-2 px-3.5 pb-1.5'}>
            {builtinColors.map((color) => (
              <Tooltip key={color.color}>
                <TooltipContent>{color.label}</TooltipContent>
                <TooltipTrigger asChild>
                  <ColorTile
                    isText
                    value={calloutPaletteTextColor(toTint(color.color))}
                    aria-label={color.label}
                    active={selectedColor === toTint(color.color)}
                    onClick={() => {
                      handlePickColor(color.color);
                      setOpen(false);
                      onSelectColor();
                    }}
                  />
                </TooltipTrigger>
              </Tooltip>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}

export default CalloutTextColor;
