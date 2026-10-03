import { readFileSync } from 'fs';
import { join } from 'path';

import { DASHBOARD_GEOMETRY, DASHBOARD_MOTION } from '@/application/database-yjs/dashboard-geometry';

import {
  DASHBOARD_COMPACT_INSET_CLASS,
  DASHBOARD_MOTION_FAST_CLASS,
  DASHBOARD_POPOVER_RADIUS,
  WIDGET_BOX_PADDING,
  WIDGET_HEADER_PADDING,
  WIDGET_SETTINGS_WIDTH,
} from '../constants';

/**
 * Tailwind needs literal class names, so the few dashboard classes that stand
 * for a token are bound to `dashboard-geometry.ts` (and through
 * `dashboard-tokens.test.ts` to `dashboard-parity/tokens.json`) here: a token
 * that moves away from its class fails this test.
 */
describe('dashboard classes that stand for tokens', () => {
  const tokensCss = readFileSync(join(__dirname, '../../../../styles/dashboard-tokens.css'), 'utf8');

  it('reads the fast motion from the CSS variables that carry the motion tokens', () => {
    expect(DASHBOARD_MOTION_FAST_CLASS.split(' ')).toEqual([
      'duration-[var(--dash-motion-fast)]',
      'ease-[var(--dash-motion-ease)]',
    ]);
    expect(tokensCss).toContain(`--dash-motion-fast: ${DASHBOARD_MOTION.fastMs}ms;`);
    expect(tokensCss).toContain(`--dash-motion-ease: ${DASHBOARD_MOTION.easing};`);
  });

  it('insets a compact page by the compact inset below the compact breakpoint', () => {
    // Tailwind: `sm` is 640px, and one spacing unit is 4px.
    expect(DASHBOARD_GEOMETRY.page.compactBreakpoint).toBe(640);
    expect(DASHBOARD_COMPACT_INSET_CLASS).toBe(`max-sm:!px-${DASHBOARD_GEOMETRY.page.compactInset / 4}`);
  });

  it('takes the widget box, header and settings host sizes from the geometry tokens', () => {
    const { widget, popover } = DASHBOARD_GEOMETRY;

    expect(WIDGET_BOX_PADDING).toBe(widget.boxPaddingInline);
    expect(widget.boxPaddingBottom).toBe(widget.boxPaddingInline);
    expect(WIDGET_HEADER_PADDING).toBe(`${widget.headerPaddingBlock}px ${widget.headerPaddingInline}px`);
    expect(WIDGET_SETTINGS_WIDTH).toBe(popover.widgetSettingsWidth);
    expect(DASHBOARD_POPOVER_RADIUS).toBe(popover.radius);
  });
});
