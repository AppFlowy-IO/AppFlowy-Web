import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { chartColorThemePreview } from '@/application/database-yjs/chart-colors';
import { CHART_COLOR_THEMES, ChartColorTheme } from '@/application/database-yjs/chart-extended-settings';

import { ChartSettingsRow } from '../ChartSettingsRow';
import { OptionListPage } from '../pages/OptionListPage';

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

function useThemeLabel() {
  const { t } = useTranslation();

  return (theme: ChartColorTheme) => t(`chart.color.${theme}`, { defaultValue: THEME_FALLBACKS[theme] });
}

/** Five swatches of a theme (12×12, radius 3, gap 2). */
function ThemeSwatches({ theme, isDark }: { theme: ChartColorTheme; isDark?: boolean }) {
  return (
    <span className='ml-auto flex shrink-0 items-center gap-0.5' data-testid={`chart-style-color-swatches-${theme}`}>
      {chartColorThemePreview(theme, isDark).map((color, index) => (
        <span className='h-3 w-3 rounded-[3px]' key={index} style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export interface ChartColorSettingProps {
  value: ChartColorTheme;
  icon?: ReactNode;
  /** Opens the Color page of the panel. */
  onOpen: () => void;
}

/** The Color row of the chart style section (`color_theme`, WP10): the theme's name; opens the Color page. */
export function ChartColorSetting({ value, icon, onOpen }: ChartColorSettingProps) {
  const { t } = useTranslation();
  const label = useThemeLabel();

  return (
    <ChartSettingsRow
      rowId='style_color'
      icon={icon}
      label={t('chart.settings.color', { defaultValue: 'Color' })}
      value={label(value)}
      onClick={onOpen}
    />
  );
}

export interface ChartColorPageProps {
  value: ChartColorTheme;
  isDark?: boolean;
  onChange: (theme: ChartColorTheme) => void;
  onBack: () => void;
}

/**
 * The Color page: Auto and Colorful (a divider after it), then Colorless and
 * the eight single hues, each with its five-step preview, in Notion's order.
 */
export function ChartColorPage({ value, isDark, onChange, onBack }: ChartColorPageProps) {
  const { t } = useTranslation();
  const label = useThemeLabel();

  return (
    <OptionListPage
      title={t('chart.settings.color', { defaultValue: 'Color' })}
      page='style-color'
      selected={value}
      onSelect={onChange}
      onBack={onBack}
      options={CHART_COLOR_THEMES.map((theme) => ({
        value: theme,
        label: label(theme),
        testValue: theme,
        trailing: theme === 'auto' ? undefined : <ThemeSwatches isDark={isDark} theme={theme} />,
        dividerAfter: theme === 'colorful',
      }))}
    />
  );
}

export default ChartColorSetting;
