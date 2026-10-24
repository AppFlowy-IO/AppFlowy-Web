import { ComponentType, SVGProps } from 'react';

import { ViewLayout } from '@/application/types';
import { ReactComponent as ChatSvg } from '@/assets/icons/ai_chat.svg';
import { ReactComponent as BoardSvg } from '@/assets/icons/board.svg';
import { ReactComponent as CalendarSvg } from '@/assets/icons/calendar.svg';
import { ReactComponent as ChartSvg } from '@/assets/icons/chart.svg';
import { ReactComponent as DashboardSvg } from '@/assets/icons/dashboard.svg';
import { ReactComponent as FeedSvg } from '@/assets/icons/feed.svg';
// No dedicated form-view SVG yet; reuse `edit.svg` — it's a pencil
// glyph that maps cleanly onto "fill out / author this form" and
// matches the desktop's form-tab icon convention.
import { ReactComponent as FormSvg } from '@/assets/icons/edit.svg';
import { ReactComponent as GallerySvg } from '@/assets/icons/gallery.svg';
import { ReactComponent as GridSvg } from '@/assets/icons/grid.svg';
import { ReactComponent as ListSvg } from '@/assets/icons/list.svg';
import { ReactComponent as DocumentSvg } from '@/assets/icons/page.svg';
import { ReactComponent as TimelineSvg } from '@/assets/icons/timeline.svg';

/** The glyph of each layout: the one place that decides it. */
const LAYOUT_GLYPHS: Partial<Record<ViewLayout, ComponentType<SVGProps<SVGSVGElement>>>> = {
  [ViewLayout.AIChat]: ChatSvg,
  [ViewLayout.Grid]: GridSvg,
  [ViewLayout.Board]: BoardSvg,
  [ViewLayout.Calendar]: CalendarSvg,
  [ViewLayout.Document]: DocumentSvg,
  [ViewLayout.Chart]: ChartSvg,
  [ViewLayout.List]: ListSvg,
  [ViewLayout.Gallery]: GallerySvg,
  [ViewLayout.Feed]: FeedSvg,
  [ViewLayout.Form]: FormSvg,
  [ViewLayout.Timeline]: TimelineSvg,
  [ViewLayout.Dashboard]: DashboardSvg,
};

const SIZE_CLASSES = { small: 'h-5 w-5', medium: 'h-6 w-6', large: 'h-8 w-8', unset: '' };

interface ViewIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  layout: ViewLayout;
  size: number | 'small' | 'medium' | 'large' | 'unset';
}

/**
 * The glyph of a view layout, or nothing for a layout without one. Any other
 * prop (`aria-*`, `data-*`, …) goes to the `<svg>`.
 */
export function ViewIcon({ layout, size, className, ...svgProps }: ViewIconProps) {
  const Glyph = LAYOUT_GLYPHS[layout];

  if (!Glyph) return null;
  const sizeClass = typeof size === 'number' ? `h-[${size}px] w-[${size}px]` : SIZE_CLASSES[size];

  return <Glyph {...svgProps} className={[sizeClass, className].filter(Boolean).join(' ')} />;
}

export default ViewIcon;
