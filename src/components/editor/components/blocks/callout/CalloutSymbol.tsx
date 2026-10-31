import { isFlagEmoji } from '@/utils/emoji';

import { CalloutGlyph } from './CalloutGlyph';

import type { CalloutIconData } from './callout.utils';

/** The native callout icon without its editing controls. */
export function CalloutSymbol({ icon, color }: { icon: CalloutIconData; color: string }) {
  if (icon.type === 'emoji') return <span className={isFlagEmoji(icon.value) ? 'icon' : undefined}>{icon.value}</span>;
  if (icon.type === 'custom')
    return <img src={icon.value} alt='' className='h-5 w-5 object-contain' draggable={false} />;
  return <CalloutGlyph id={icon.value} color={icon.color || color} />;
}
