import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, SubscriptionPlan } from '@/application/types';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ColorTile, ColorTileIcon } from '@/components/_shared/color-picker';
import { Origins, Popover } from '@/components/_shared/popover';
import { BlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ColorEnum, renderColor } from '@/utils/color';
import { isAppFlowyHosted } from '@/utils/subscription';

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

function Color({ node, onSelectColor }: { node: BlockNode; onSelectColor: () => void }) {
  const { getSubscriptions } = useEditorContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const blockId = node.blockId;
  const hasNonTransparentBg = [BlockType.CalloutBlock, BlockType.OutlineBlock].includes(node.type);
  const [originalColor, setOriginalColor] = useState<string>(node.data?.bgColor || '');
  const selectedColor = originalColor || (hasNonTransparentBg ? ColorEnum.Tint10 : '');

  const [activeSubscriptionPlan, setActiveSubscriptionPlan] = useState<SubscriptionPlan | null>(null);
  // Pro features are enabled by default on self-hosted instances
  const isPro = activeSubscriptionPlan === SubscriptionPlan.Pro || !isAppFlowyHosted();

  const loadSubscription = useCallback(async () => {
    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscriptionPlan(SubscriptionPlan.Free);
        return;
      }

      const subscription = subscriptions[0];

      setActiveSubscriptionPlan(subscription?.plan || SubscriptionPlan.Free);
    } catch (e) {
      setActiveSubscriptionPlan(SubscriptionPlan.Free);
      console.error(e);
    }
  }, [getSubscriptions]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const builtinColors = useMemo(() => {
    const proPalette = [
      { color: ColorEnum.Tint1, label: t('colors.mauve') },
      { color: ColorEnum.Tint11, label: t('colors.lavender') },
      { color: ColorEnum.Tint2, label: t('colors.lilac') },
      { color: ColorEnum.Tint12, label: t('colors.mallow') },
      { color: ColorEnum.Tint3, label: t('colors.camellia') },
      { color: ColorEnum.Tint13, label: t('colors.rose') },
      { color: ColorEnum.Tint4, label: t('colors.papaya') },
      { color: ColorEnum.Tint5, label: t('colors.mango') },
      { color: ColorEnum.Tint14, label: t('colors.lemon') },
      { color: ColorEnum.Tint6, label: t('colors.olive') },
      { color: ColorEnum.Tint7, label: t('colors.grass') },
      { color: ColorEnum.Tint8, label: t('colors.jade') },
      { color: ColorEnum.Tint9, label: t('colors.azure') },
      ...(!hasNonTransparentBg ? [{ color: ColorEnum.Tint10, label: t('colors.iron') }] : []),
    ];

    const freePalette = [
      { color: ColorEnum.Tint1, label: t('colors.mauve') },
      { color: ColorEnum.Tint2, label: t('colors.lilac') },
      { color: ColorEnum.Tint3, label: t('colors.camellia') },
      { color: ColorEnum.Tint4, label: t('colors.papaya') },
      { color: ColorEnum.Tint5, label: t('colors.mango') },
      { color: ColorEnum.Tint6, label: t('colors.olive') },
      { color: ColorEnum.Tint7, label: t('colors.grass') },
      { color: ColorEnum.Tint8, label: t('colors.jade') },
      { color: ColorEnum.Tint9, label: t('colors.azure') },
    ];

    return [
      { color: hasNonTransparentBg ? ColorEnum.Tint10 : '', label: t('colors.default') },
      ...(isPro ? proPalette : freePalette),
    ];
  }, [isPro, hasNonTransparentBg, t]);

  const handlePickColor = useCallback(
    (bgColor: string) => {
      if (bgColor === selectedColor) {
        CustomEditor.setBlockData(editor, blockId, {
          bgColor: null,
        });
        setOriginalColor('');
        return;
      }

      CustomEditor.setBlockData(editor, blockId, {
        bgColor: bgColor || null,
      });
      setOriginalColor(bgColor);
    },
    [blockId, editor, selectedColor]
  );

  return (
    <>
      <Button
        ref={ref}
        size='sm'
        variant='ghost'
        className={'justify-start px-1 py-1.5'}
        onClick={() => {
          setOpen(true);
        }}
      >
        <ColorTileIcon value={renderColor(selectedColor)} />
        {t('document.plugins.optionAction.color')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
      <Popover open={open} anchorEl={ref.current} onClose={() => setOpen(false)} {...origins}>
        <div className='flex w-[200px] flex-col py-1.5'>
          <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>
            {t('editor.backgroundColor')}
          </div>
          <div className={'flex flex-wrap gap-2 px-3.5 pb-1.5'}>
            {builtinColors.map((color, index) => (
              <Tooltip key={index}>
                <TooltipContent>{color.label}</TooltipContent>
                <TooltipTrigger asChild>
                  <ColorTile
                    value={renderColor(color.color)}
                    active={selectedColor === color.color}
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

export default Color;
