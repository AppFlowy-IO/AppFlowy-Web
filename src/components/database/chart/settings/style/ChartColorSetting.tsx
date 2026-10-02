import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { chartColorThemePreview } from '@/application/database-yjs/chart-colors';
import { CHART_COLOR_THEMES, ChartColorTheme } from '@/application/database-yjs/chart-extended-settings';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const THEME_FALLBACKS: Record<ChartColorTheme, string> = {
  auto: 'Auto',
  colorful: 'Colorful',
  colorless: 'Colorless',
  blue: 'Blue',
  yellow: 'Yellow',
  green: 'Green',
  purple: 'Purple',
  teal: 'Teal',
  orange: 'Orange',
  pink: 'Pink',
  red: 'Red',
};

export interface ChartColorSettingProps {
  value: ChartColorTheme;
  isDark?: boolean;
  onChange: (theme: ChartColorTheme) => void;
}

/** Five 10×10 swatches of a theme (radius 2). */
function ThemeSwatches({ theme, isDark }: { theme: ChartColorTheme; isDark?: boolean }) {
  return (
    <span className='ml-auto flex items-center gap-0.5' data-testid={`chart-style-color-swatches-${theme}`}>
      {chartColorThemePreview(theme, isDark).map((color, index) => (
        <span
          className='h-2.5 w-2.5'
          key={index}
          style={{ backgroundColor: color, borderRadius: DASHBOARD_CHART_GEOMETRY.legend.swatchRadius }}
        />
      ))}
    </span>
  );
}

/**
 * The Color row of the chart style settings (`color_theme`): Auto and
 * Colorful, a divider, then Colorless and the eight single hues, each with
 * its five-step preview, in Notion's order.
 */
export function ChartColorSetting({ value, isDark, onChange }: ChartColorSettingProps) {
  const { t } = useTranslation();
  const label = (theme: ChartColorTheme) => t(`chart.color.${theme}`, { defaultValue: THEME_FALLBACKS[theme] });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='chart-style-color'>
        <span>{t('chart.style.color', { defaultValue: 'Color' })}</span>
        <span className='ml-auto text-text-secondary'>{label(value)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className='appflowy-scroller max-h-[360px] overflow-y-auto'>
          {CHART_COLOR_THEMES.map((theme) => (
            <Fragment key={theme}>
              <DropdownMenuItem
                className='w-full'
                data-testid={`chart-style-color-option-${theme}`}
                onSelect={(event) => {
                  event.preventDefault();
                  onChange(theme);
                }}
              >
                <span>{label(theme)}</span>
                {theme === 'auto' ? <span className='ml-auto' /> : <ThemeSwatches isDark={isDark} theme={theme} />}
                {value === theme ? <DropdownMenuItemTick /> : <span className='w-5 shrink-0' />}
              </DropdownMenuItem>
              {theme === 'colorful' ? <DropdownMenuSeparator /> : null}
            </Fragment>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default ChartColorSetting;
