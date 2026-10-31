import type { CSSProperties } from 'react';

import { DASHBOARD_GEOMETRY, DASHBOARD_TYPOGRAPHY } from '@/application/database-yjs/dashboard-geometry';

/** The drill-down dialog geometry (WP13 §3.10), `tokens.json` `geometry.drilldown`. */
export const DRILL = DASHBOARD_GEOMETRY.drilldown;
/** The record side peek geometry (WP13 §3.9), `tokens.json` `geometry.sidePeek`. */
export const SIDE_PEEK = DASHBOARD_GEOMETRY.sidePeek;

type TypographyToken = { size: number; lineHeight: number; weight: number };

export function typography(token: TypographyToken): CSSProperties {
  return { fontSize: token.size, lineHeight: `${token.lineHeight}px`, fontWeight: token.weight };
}

export const DRILL_TITLE_STYLE = typography(DASHBOARD_TYPOGRAPHY.drilldownTitle);
export const DRILL_COUNT_STYLE = typography(DASHBOARD_TYPOGRAPHY.drilldownCount);
export const DRILL_CELL_STYLE = typography(DASHBOARD_TYPOGRAPHY.drilldownCell);
export const DRILL_OPEN_STYLE: CSSProperties = {
  ...typography(DASHBOARD_TYPOGRAPHY.drilldownOpen),
  height: DRILL.openPillHeight,
  letterSpacing: '0.04em',
};
export const DRILL_PILL_TEXT_STYLE = typography(DASHBOARD_TYPOGRAPHY.pill);

/**
 * The title row sits `titleTop` from the top; the chips start at `chipsTop`, the table at `tableTop`.
 * The row is the title's line: the 28px tools centre on it and overhang it by 2px (their top is 16).
 */
export const DRILL_HEADER_STYLE: CSSProperties = {
  marginTop: DRILL.titleTop,
  height: DASHBOARD_TYPOGRAPHY.drilldownTitle.lineHeight,
  paddingLeft: DRILL.paddingInline,
  paddingRight: DRILL.toolsInsetRight,
};
export const DRILL_CHIPS_STYLE: CSSProperties = {
  marginTop: DRILL.chipsTop - DRILL.titleTop - DASHBOARD_TYPOGRAPHY.drilldownTitle.lineHeight,
  minHeight: DRILL.chipHeight,
  paddingLeft: DRILL.paddingInline,
  paddingRight: DRILL.paddingInline,
};
export const DRILL_TABLE_STYLE: CSSProperties = {
  marginTop: DRILL.tableTop - DRILL.chipsTop - DRILL.chipHeight,
  paddingLeft: DRILL.paddingInline,
};
export const DRILL_PILL_STYLE: CSSProperties = {
  height: DRILL.chipHeight,
  borderRadius: DRILL.chipRadius,
  ...DRILL_PILL_TEXT_STYLE,
};
export const DRILL_TOOL_STYLE: CSSProperties = { width: DRILL.toolButton, height: DRILL.toolButton };
export const DRILL_DISMISS_STYLE: CSSProperties = { width: DRILL.dismissSize, height: DRILL.dismissSize };
