import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as ColorSvg } from '@/assets/icons/text_highlight.svg';
import { ColorTile } from '@/components/_shared/color-picker';
import { CustomColorPicker } from '@/components/_shared/color-picker/CustomColorPicker';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { renderColor } from '@/utils/color';

import ActionButton from './ActionButton';
import { CreateCustomColorTile } from './TextColor';

function BgColor({
  focusEditor: focusEditor,
  toggleDisableEditorFocus,
}: {
  focusEditor: (timeout?: number) => void;
  toggleDisableEditorFocus: () => void;
}) {
  const { t } = useTranslation();
  const { getSubscriptions } = useEditorContext();
  const { visible, forceShow } = useSelectionToolbarContext();
  const editor = useSlateStatic() as YjsEditor;
  const marks = CustomEditor.getAllMarks(editor).map(
    (mark) => mark[EditorMarkFormat.BgToken] || mark[EditorMarkFormat.BgColor] || ''
  );
  const unique = [...new Set(marks)];
  const singleColor = unique.length === 1 ? unique[0] : undefined;

  const [isOpen, setIsOpen] = useState(false);
  const [isChoosingCustom, setIsChoosingCustom] = useState(false);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const recentColorToSave = useRef<string | null>(null);
  const initialColor = useRef<string | null>(null);

  const { isPro } = useSubscriptionPlan(getSubscriptions);
  const maxCustomColors = isPro ? 9 : 4;

  const isCustomColor = useCallback((color: string) => {
    return color.startsWith('#') || color.startsWith('0x');
  }, []);

  const loadRecentAndCustomColors = useCallback(() => {
    const recent = localStorage.getItem('recent-bg-colors');
    const custom = localStorage.getItem('custom-bg-colors');

    try {
      const recentParsed: string[] = recent ? JSON.parse(recent) : [];

      setRecentColors(recentParsed.slice(0, 5));
    } catch (e) {
      console.error('Failed to parse recent colors:', e);
    }

    try {
      const customParsed: string[] = custom ? JSON.parse(custom) : [];
      let updatedCustomColors = customParsed.slice(0, maxCustomColors);

      if (singleColor !== undefined && isCustomColor(singleColor) && !updatedCustomColors.includes(singleColor)) {
        updatedCustomColors = [singleColor, ...updatedCustomColors].slice(0, maxCustomColors);
      }

      setCustomColors(updatedCustomColors);
    } catch (e) {
      console.error('Failed to parse recent colors:', e);
    }
  }, [isCustomColor, maxCustomColors, singleColor]);

  useEffect(() => {
    if (!visible && isOpen) {
      setIsOpen(false);
    }
  }, [isOpen, visible]);

  const getRawColorValue = useCallback(
    (color: string) => {
      if (isCustomColor(color)) {
        return color;
      }

      const computedStyle = window.getComputedStyle(document.documentElement);

      if (color === '' || color === 'bg-default') {
        return '#ffffff';
      }

      return computedStyle.getPropertyValue(`--palette-${color}`);
    },
    [isCustomColor]
  );

  const handlePickColor = useCallback(
    (color: string) => {
      if (color === '' || color === 'bg-default' || color === singleColor) {
        CustomEditor.removeMark(editor, EditorMarkFormat.BgColor);
        CustomEditor.removeMark(editor, EditorMarkFormat.BgToken);
        forceShow(true);
        return;
      }

      if (isCustomColor(color)) {
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.BgColor,
          value: color,
        });
        CustomEditor.removeMark(editor, EditorMarkFormat.BgToken);
      } else {
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.BgColor,
          value: window.getComputedStyle(document.documentElement).getPropertyValue(`--palette-${color}`),
        });
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.BgToken,
          value: color,
        });
      }

      forceShow(true);
      recentColorToSave.current = color;
    },
    [editor, forceShow, isCustomColor, singleColor]
  );

  const handleCreateCustomColor = useCallback(
    (color: string) => {
      if (!color || customColors.includes(color)) {
        return;
      }

      const updatedCustomColors = [...customColors, color].slice(-maxCustomColors);

      setCustomColors(updatedCustomColors);
      localStorage.setItem('custom-bg-colors', JSON.stringify(updatedCustomColors));
    },
    [customColors, maxCustomColors]
  );

  const saveRecentColors = useCallback(() => {
    if (!recentColorToSave.current) {
      return;
    }

    const color = recentColorToSave.current;

    if (color && color !== initialColor.current) {
      const updated = [color, ...recentColors.filter((c) => c !== color)].slice(0, 5);

      localStorage.setItem('recent-bg-colors', JSON.stringify(updated));
    }

    recentColorToSave.current = null;
  }, [recentColors]);

  const builtinColors = useMemo(() => {
    return isPro
      ? [
        {
          label: t('colors.default'),
          color: '',
        },
        {
          label: t('colors.mauve'),
          color: 'bg-color-14',
        },
        {
          label: t('colors.lavender'),
          color: 'bg-color-15',
        },
        {
          label: t('colors.lilac'),
          color: 'bg-color-16',
        },
        {
          label: t('colors.mallow'),
          color: 'bg-color-17',
        },
        {
          label: t('colors.camellia'),
          color: 'bg-color-18',
        },
        {
          label: t('colors.rose'),
          color: 'bg-color-1',
        },
        {
          label: t('colors.papaya'),
          color: 'bg-color-2',
        },
        {
          label: t('colors.mango'),
          color: 'bg-color-4',
        },
        {
          label: t('colors.lemon'),
          color: 'bg-color-5',
        },
        {
          label: t('colors.olive'),
          color: 'bg-color-6',
        },
        {
          label: t('colors.grass'),
          color: 'bg-color-8',
        },
        {
          label: t('colors.jade'),
          color: 'bg-color-10',
        },
        {
          label: t('colors.azure'),
          color: 'bg-color-12',
        },
        {
          label: t('colors.iron'),
          color: 'bg-color-20',
        },
      ]
      : [
        {
          label: t('colors.default'),
          color: '',
        },
        {
          label: t('colors.mauve'),
          color: 'bg-color-14',
        },
        {
          label: t('colors.lilac'),
          color: 'bg-color-16',
        },
        {
          label: t('colors.camellia'),
          color: 'bg-color-18',
        },
        {
          label: t('colors.papaya'),
          color: 'bg-color-2',
        },
        {
          label: t('colors.mango'),
          color: 'bg-color-4',
        },
        {
          label: t('colors.olive'),
          color: 'bg-color-6',
        },
        {
          label: t('colors.grass'),
          color: 'bg-color-8',
        },
        {
          label: t('colors.jade'),
          color: 'bg-color-10',
        },
        {
          label: t('colors.azure'),
          color: 'bg-color-12',
        },
      ];
  }, [isPro, t]);

  const handleOpen = useCallback(() => {
    setIsChoosingCustom(false);
    initialColor.current = singleColor || null;
    loadRecentAndCustomColors();
  }, [loadRecentAndCustomColors, singleColor]);

  const popoverContent = useMemo(() => {
    if (isChoosingCustom) {
      return (
        <div className='w-[236px] p-3'>
          <CustomColorPicker
            value={getRawColorValue(singleColor ?? '#ffffff')}
            transparency='99'
            onCancel={() => setIsChoosingCustom(false)}
            onApply={(color) => {
              handleCreateCustomColor(color);
              handlePickColor(color);
              setIsChoosingCustom(false);
            }}
          />
        </div>
      );
    }

    return (
      <div className={'flex w-[200px] flex-col py-1.5'}>
        {recentColors.length > 0 && (
          <>
            <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>{t('colors.recent')}</div>
            <div className={'flex gap-2 px-3.5 pb-1.5'}>
              {recentColors.map((color, index) => (
                <ColorTile
                  key={index}
                  value={renderColor(color)}
                  active={singleColor === color}
                  onClick={() => handlePickColor(color)}
                />
              ))}
            </div>
            <Separator className={'my-2'} />
          </>
        )}
        <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>{t('editor.backgroundColor')}</div>
        <div className={'flex flex-wrap gap-2 px-3.5 pb-1.5'}>
          {builtinColors.map((color, index) => (
            <Tooltip key={index}>
              <TooltipContent>{color.label}</TooltipContent>
              <TooltipTrigger asChild>
                <ColorTile
                  value={renderColor(color.color)}
                  active={singleColor === color.color}
                  onClick={() => handlePickColor(color.color)}
                />
              </TooltipTrigger>
            </Tooltip>
          ))}
        </div>
        <Separator className={'my-2'} />
        <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>{t('colors.custom')}</div>
        <div className='flex flex-wrap gap-2 px-3.5 pb-1.5'>
          {customColors.map((color, index) => (
            <ColorTile
              key={index}
              value={renderColor(color)}
              active={singleColor === color}
              onClick={() => handlePickColor(color)}
            />
          ))}
          <CreateCustomColorTile onClick={() => setIsChoosingCustom(true)} />
        </div>
      </div>
    );
  }, [
    builtinColors,
    customColors,
    getRawColorValue,
    handleCreateCustomColor,
    handlePickColor,
    isChoosingCustom,
    recentColors,
    singleColor,
    t,
  ]);

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          saveRecentColors();
          focusEditor(50);
        }

        setIsOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <ActionButton
          active={!!singleColor}
          tooltip={t('editor.backgroundColor')}
          data-testid="bg-color-button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();

            forceShow(!isOpen);
            if (isOpen) {
              saveRecentColors();
              focusEditor();
            } else {
              handleOpen();
              toggleDisableEditorFocus();
            }

            setIsOpen(!isOpen);
          }}
        >
          <ColorSvg className='h-4 w-4' />
        </ActionButton>
      </PopoverTrigger>
      <PopoverContent
        className='!min-w-[200px]'
        sideOffset={6}
        align='start'
        onMouseUp={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onFocusCapture={(e) => e.stopPropagation()}
        onOpenAutoFocus={() => {
          window.getSelection()?.removeAllRanges();
          toggleDisableEditorFocus();
        }}
        onCloseAutoFocus={() => {
          focusEditor(0);
        }}
        onFocusOutside={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {popoverContent}
      </PopoverContent>
    </Popover>
  );
}

export default BgColor;
