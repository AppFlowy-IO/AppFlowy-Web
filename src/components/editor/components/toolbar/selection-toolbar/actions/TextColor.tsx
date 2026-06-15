import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as ColorSvg } from '@/assets/icons/text_color.svg';
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

function TextColor({
  focusEditor,
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
    (mark) => mark[EditorMarkFormat.FontToken] || mark[EditorMarkFormat.FontColor] || ''
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
    const recent = localStorage.getItem('recent-text-colors');
    const custom = localStorage.getItem('custom-text-colors');

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

      if (color === '' || color === 'text-default') {
        return computedStyle.getPropertyValue('--text-primary');
      }

      return computedStyle.getPropertyValue(`--palette-${color}`);
    },
    [isCustomColor]
  );

  const handlePickColor = useCallback(
    (color: string) => {
      if (color === '' || color === 'text-default' || color === singleColor) {
        CustomEditor.removeMark(editor, EditorMarkFormat.FontColor);
        CustomEditor.removeMark(editor, EditorMarkFormat.FontToken);
        forceShow(true);
        return;
      }

      if (isCustomColor(color)) {
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.FontColor,
          value: color,
        });
        CustomEditor.removeMark(editor, EditorMarkFormat.FontToken);
      } else {
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.FontColor,
          value: window.getComputedStyle(document.documentElement).getPropertyValue(`--palette-${color}`),
        });
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.FontToken,
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
      localStorage.setItem('custom-text-colors', JSON.stringify(updatedCustomColors));
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

      localStorage.setItem('recent-text-colors', JSON.stringify(updated));
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
          color: 'text-color-14',
        },
        {
          label: t('colors.lavender'),
          color: 'text-color-15',
        },
        {
          label: t('colors.lilac'),
          color: 'text-color-16',
        },
        {
          label: t('colors.mallow'),
          color: 'text-color-17',
        },
        {
          label: t('colors.camellia'),
          color: 'text-color-18',
        },
        {
          label: t('colors.rose'),
          color: 'text-color-1',
        },
        {
          label: t('colors.papaya'),
          color: 'text-color-2',
        },
        {
          label: t('colors.mango'),
          color: 'text-color-4',
        },
        {
          label: t('colors.lemon'),
          color: 'text-color-5',
        },
        {
          label: t('colors.olive'),
          color: 'text-color-6',
        },
        {
          label: t('colors.grass'),
          color: 'text-color-8',
        },
        {
          label: t('colors.jade'),
          color: 'text-color-10',
        },
        {
          label: t('colors.azure'),
          color: 'text-color-12',
        },
        {
          label: t('colors.iron'),
          color: 'text-color-20',
        },
      ]
      : [
        {
          label: t('colors.default'),
          color: '',
        },
        {
          label: t('colors.mauve'),
          color: 'text-color-14',
        },
        {
          label: t('colors.lilac'),
          color: 'text-color-16',
        },
        {
          label: t('colors.camellia'),
          color: 'text-color-18',
        },
        {
          label: t('colors.papaya'),
          color: 'text-color-2',
        },
        {
          label: t('colors.mango'),
          color: 'text-color-4',
        },
        {
          label: t('colors.olive'),
          color: 'text-color-6',
        },
        {
          label: t('colors.grass'),
          color: 'text-color-8',
        },
        {
          label: t('colors.jade'),
          color: 'text-color-10',
        },
        {
          label: t('colors.azure'),
          color: 'text-color-12',
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
                  isText
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
        <div className={'px-3.5 pb-2 pt-1.5 text-xs font-medium text-text-tertiary'}>{t('editor.textColor')}</div>
        <div className={'flex flex-wrap gap-2 px-3.5 pb-1.5'}>
          {builtinColors.map((color, index) => (
            <Tooltip key={index}>
              <TooltipContent>{color.label}</TooltipContent>
              <TooltipTrigger asChild>
                <ColorTile
                  isText
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
              isText
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
          tooltip={t('editor.textColor')}
          data-testid="text-color-button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();

            forceShow(!isOpen);
            if (isOpen) {
              saveRecentColors();
              focusEditor(0);
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

export default TextColor;

export function CreateCustomColorTile({ onClick }: { onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={
        'flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] border border-border-primary hover:border-border-primary-hover'
      }
    >
      <AddIcon className='h-5 w-5 text-icon-tertiary' />
    </div>
  );
}
