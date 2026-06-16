import { useCallback, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import './style.css';

export function CustomColorPicker({
  value,
  transparency = '',
  onCancel,
  onApply,
}: {
  value: string;
  transparency?: string;
  onCancel: () => void;
  onApply: (color: string) => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState(argbToHtmlHex(value));
  const [colorHex, setColorHex] = useState(argbToHtmlHex(value));

  const handleChange = useCallback((newColor: string) => {
    if (!newColor) {
      return;
    }

    const color = argbToHtmlHex(newColor);

    setColor(color);
    setColorHex(color);
  }, []);

  return (
    <div className='flex flex-col gap-3'>
      <HexColorPicker color={color} onChange={handleChange} className='custom-color-picker' />
      <div className='mb-5 flex gap-2'>
        <div style={{ backgroundColor: color }} className='h-8 w-8 min-w-8 rounded-[16px] border border-border-primary' />
        <Input
          value={colorHex}
          onChange={(e) => setColorHex(e.target.value)}
          onBlur={(e) => handleChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={onCancel}>
          {t('button.cancel')}
        </Button>
        <Button
          onClick={() => {
            const converted = rgbaToArgb(color + transparency);

            onApply(converted);
          }}
        >
          {t('button.apply')}
        </Button>
      </div>
    </div>
  );
}

function rgbaToArgb(color: string): string {
  if (!color) {
    return '';
  }

  const hexRegex = /^#([A-Fa-f0-9]{6})([A-Fa-f0-9]{2})?$/;
  const match = color.match(hexRegex);

  if (!match) {
    return '';
  }

  const r = Number.parseInt(match[1].substring(0, 2), 16);
  const g = Number.parseInt(match[1].substring(2, 4), 16);
  const b = Number.parseInt(match[1].substring(4, 6), 16);
  let a = 255;

  if (typeof match[2] !== 'undefined') {
    a = Number.parseInt(match[2], 16);
  }

  const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');

  return `0x${hex(a)}${hex(r)}${hex(g)}${hex(b)}`;
}

function argbToHtmlHex(color: string): string {
  if (!color) {
    return '#ffffff';
  }

  const rgbaRegex = /^#([A-Fa-f0-9]{6})([A-Fa-f0-9]{2})?$/;
  const rgbaMatch = color.match(rgbaRegex);

  if (rgbaMatch) {
    return `#${rgbaMatch[1]}`;
  }

  const hexRegex = /^0x([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6})$/;
  const match = color.match(hexRegex);

  if (!match) {
    return '#ffffff';
  }

  let r = 0,
    g = 0,
    b = 0;

  if (match[1].length === 8) {
    r = Number.parseInt(match[1].substring(2, 4), 16);
    g = Number.parseInt(match[1].substring(4, 6), 16);
    b = Number.parseInt(match[1].substring(6, 8), 16);
  } else if (match[1].length === 6) {
    r = Number.parseInt(match[1].substring(0, 2), 16);
    g = Number.parseInt(match[1].substring(2, 4), 16);
    b = Number.parseInt(match[1].substring(4, 6), 16);
  }

  const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');

  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
