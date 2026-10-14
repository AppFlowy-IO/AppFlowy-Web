import emojiRegex from 'emoji-regex';

import { CalloutBlockData, ViewIconType } from '@/application/types';
import { ColorEnum, toBlockColor } from '@/utils/color';

export type QuickStyleOption = {
  key: string;
  labelKey: string;
  iconGroup: string;
  iconName: string;
  color: ColorEnum;
};

export const QUICK_STYLE_OPTIONS = [
  {
    key: 'basic',
    labelKey: 'document.callout.basic',
    iconGroup: 'mail',
    iconName: 'chat-bubble-typing-oval',
    color: ColorEnum.Tint10,
  },
  {
    key: 'info',
    labelKey: 'document.callout.info',
    iconGroup: 'interface_essential',
    iconName: 'information-circle',
    color: ColorEnum.Tint9,
  },
  {
    key: 'tip',
    labelKey: 'document.callout.tip',
    iconGroup: 'interface_essential',
    iconName: 'help-question-1',
    color: ColorEnum.Tint8,
  },
  {
    key: 'warning',
    labelKey: 'document.callout.warning',
    iconGroup: 'interface_essential',
    iconName: 'warning-triangle',
    color: ColorEnum.Tint5,
  },
  {
    key: 'alert',
    labelKey: 'document.callout.alert',
    iconGroup: 'interface_essential',
    iconName: 'warning-octagon',
    color: ColorEnum.Tint13,
  },
] as const;

export const MORE_STYLE_OPTIONS = [
  {
    key: 'insight',
    labelKey: 'document.callout.insight',
    iconGroup: 'artificial_intelligence',
    iconName: 'ai-upscale-spark',
    color: ColorEnum.Tint1,
  },
  {
    key: 'idea',
    labelKey: 'document.callout.idea',
    iconGroup: 'artificial_intelligence',
    iconName: 'ai-technology-spark',
    color: ColorEnum.Tint2,
  },
  {
    key: 'spark',
    labelKey: 'document.callout.spark',
    iconGroup: 'interface_essential',
    iconName: 'star-1',
    color: ColorEnum.Tint4,
  },
  {
    key: 'context',
    labelKey: 'document.callout.context',
    iconGroup: 'interface_essential',
    iconName: 'text-flow-rows',
    color: ColorEnum.Tint6,
  },
  {
    key: 'note',
    labelKey: 'document.callout.note',
    iconGroup: 'interface_essential',
    iconName: 'new-sticky-note',
    color: ColorEnum.Tint7,
  },
] as const;

// Version 1 distinguishes an intentionally removed icon from legacy callouts.
export const CALLOUT_ICON_VERSION = 1;
export const DEFAULT_CALLOUT_DATA: CalloutBlockData = {
  icon: JSON.stringify({ groupName: 'mail', iconName: 'chat-bubble-typing-oval', color: '' }),
  icon_type: 'icon',
  version: CALLOUT_ICON_VERSION,
};

export type CalloutIconData =
  | { type: 'icon'; value: string; color?: string }
  | { type: 'emoji'; value: string }
  | { type: 'custom'; value: string };

export function getCalloutIcon(data: Partial<CalloutBlockData>): CalloutIconData | null {
  if (!data.icon) {
    return (data.version ?? 0) < CALLOUT_ICON_VERSION ? { type: 'icon', value: 'mail/chat-bubble-typing-oval' } : null;
  }

  if (data.icon_type === 'emoji') return { type: 'emoji', value: data.icon };
  if (!data.icon_type) {
    const emoji = data.icon.match(emojiRegex())?.[0];

    return emoji === data.icon ? { type: 'emoji', value: data.icon } : null;
  }

  if (data.icon_type === 'custom') return { type: 'custom', value: data.icon };

  try {
    const icon = JSON.parse(data.icon);

    if (typeof icon?.groupName !== 'string' || typeof icon?.iconName !== 'string') return null;
    return { type: 'icon', value: `${icon.groupName}/${icon.iconName}`, color: icon.color || undefined };
  } catch {
    return null;
  }
}

export function calloutIconUpdate(icon: { ty: ViewIconType; value: string; color?: string }): CalloutBlockData {
  return {
    icon:
      icon.ty === ViewIconType.Icon
        ? JSON.stringify({
            groupName: icon.value.split('/')[0],
            iconName: icon.value.split('/')[1],
            color: icon.color || '',
          })
        : icon.value,
    icon_type: icon.ty === ViewIconType.Icon ? 'icon' : icon.ty === ViewIconType.URL ? 'custom' : 'emoji',
    version: CALLOUT_ICON_VERSION,
  };
}

export function calloutPresetData(preset: QuickStyleOption): CalloutBlockData {
  return {
    icon: JSON.stringify({ groupName: preset.iconGroup, iconName: preset.iconName, color: '' }),
    icon_type: 'icon',
    version: CALLOUT_ICON_VERSION,
    bgColor: preset.color,
    textColor: preset.color,
  };
}

// Flutter uses block token 3 for tint14; its palette swatch uses token 5.
export function toCalloutColor(tint: ColorEnum) {
  if (tint === ColorEnum.Tint14) {
    return {
      bg: ColorEnum.BlockBgColor3,
      bgHover: ColorEnum.BlockBgHoverColor3,
      text: ColorEnum.BlockTextColor3,
      border: ColorEnum.BlockBorderColor3,
      icon: ColorEnum.BlockIconColor3,
    };
  }

  return toBlockColor(tint);
}

export function getCalloutColors(data: Partial<CalloutBlockData>) {
  const colors = toCalloutColor((data.bgColor || ColorEnum.Tint10) as ColorEnum);

  return { ...colors, text: data.textColor ? toCalloutColor(data.textColor as ColorEnum).text : colors.text };
}

// Figma uses palette-text-color for swatches, and block-text-color in the block.
export function calloutPaletteTextColor(tint: ColorEnum) {
  if (tint === ColorEnum.Tint10) return 'var(--text-primary)';
  const suffix = toBlockColor(tint).text.match(/(\d+)$/)?.[1];

  return `var(--palette-text-color-${suffix})`;
}
