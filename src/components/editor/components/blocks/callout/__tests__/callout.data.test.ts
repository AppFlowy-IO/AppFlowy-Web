import { ViewIconType } from '@/application/types';
import { ColorEnum } from '@/utils/color';

import { calloutIconUpdate, calloutPaletteTextColor, getCalloutColors, getCalloutIcon } from '../callout.utils';

describe('Flutter callout document compatibility', () => {
  it('distinguishes a legacy missing icon from a deliberately removed icon', () => {
    expect(getCalloutIcon({})).toEqual({ type: 'icon', value: 'mail/chat-bubble-typing-oval' });
    expect(getCalloutIcon({ icon: '', version: 1 })).toBeNull();
    expect(getCalloutIcon({ icon: null, version: 2 })).toBeNull();
    expect(getCalloutIcon({ icon: 'invalid legacy data' })).toBeNull();
    expect(getCalloutIcon({ icon: '{broken', icon_type: 'icon' })).toBeNull();
  });

  it.each(['🔥', '👩🏽‍💻', '🇺🇸'])('renders a legacy multi-codepoint emoji: %s', (icon) => {
    expect(getCalloutIcon({ icon })).toEqual({ type: 'emoji', value: icon });
  });

  it('round trips a selected catalog icon and its custom color in Flutter’s JSON format', () => {
    const data = calloutIconUpdate({
      ty: ViewIconType.Icon,
      value: 'mail/chat-bubble-typing-oval',
      color: '0xFF409BF8',
    });

    expect(data).toEqual({
      icon_type: 'icon',
      version: 1,
      icon: JSON.stringify({ groupName: 'mail', iconName: 'chat-bubble-typing-oval', color: '0xFF409BF8' }),
    });
    expect(getCalloutIcon(data)).toEqual({ type: 'icon', value: 'mail/chat-bubble-typing-oval', color: '0xFF409BF8' });
  });

  it('persists uploaded images as Flutter custom icons', () => {
    const data = calloutIconUpdate({ ty: ViewIconType.URL, value: 'https://example.com/icon.png' });

    expect(data).toEqual({ icon: 'https://example.com/icon.png', icon_type: 'custom', version: 1 });
    expect(getCalloutIcon(data)).toEqual({ type: 'custom', value: 'https://example.com/icon.png' });
  });

  it('inherits the background tint until an explicit text tint is chosen', () => {
    expect(getCalloutColors({ bgColor: ColorEnum.Tint9 }).text).toBe(ColorEnum.BlockTextColor12);
    expect(getCalloutColors({ bgColor: ColorEnum.Tint9, textColor: ColorEnum.Tint8 }).text).toBe(
      ColorEnum.BlockTextColor10
    );
    expect(getCalloutColors({ bgColor: ColorEnum.Tint9, textColor: ColorEnum.Tint10 }).text).toBe(
      ColorEnum.BlockTextColor20
    );
  });

  it('matches Flutter’s special tint14 mapping without changing the palette token', () => {
    expect(getCalloutColors({ bgColor: ColorEnum.Tint14 })).toEqual({
      bg: ColorEnum.BlockBgColor3,
      bgHover: ColorEnum.BlockBgHoverColor3,
      text: ColorEnum.BlockTextColor3,
      border: ColorEnum.BlockBorderColor3,
      icon: ColorEnum.BlockIconColor3,
    });
    expect(calloutPaletteTextColor(ColorEnum.Tint14)).toBe('var(--palette-text-color-5)');
  });
});
