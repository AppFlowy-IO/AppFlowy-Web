import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';

import {
  DOCK_GAP,
  DOCK_PADDING,
  DOCK_WIDTH,
  dockedPopoverSide,
  dockMaxHeight,
  dockPopperProps,
} from '../docked-popover';

interface AddWidgetFixture {
  docked_popover_side: { anchor_right_x: number; viewport_right_x: number; expect: 'left' | 'right' }[];
}

const FIXTURE = loadParityFixture<AddWidgetFixture>('add-widget.json');

describe('dockedPopoverSide against add-widget.json', () => {
  it('uses the shared dock geometry', () => {
    expect([DOCK_WIDTH, DOCK_GAP, DOCK_PADDING]).toEqual([300, 8, 16]);
  });

  it.each(FIXTURE.docked_popover_side.map((vector) => [JSON.stringify(vector), vector] as const))(
    '%s',
    (_name, vector) => {
      expect(dockedPopoverSide(vector.anchor_right_x, vector.viewport_right_x)).toBe(vector.expect);
    }
  );

  it('caps the dock at 560 and keeps at least 320 of it visible', () => {
    expect(dockMaxHeight(100, 1000)).toBe(560);
    expect(dockMaxHeight(500, 1000)).toBe(484);
    expect(dockMaxHeight(900, 1000)).toBe(320);
  });
});

describe('dockPopperProps', () => {
  it('top-aligns the dock on its side, 8px from the anchor, clamped 16px inside the viewport', () => {
    expect(dockPopperProps('left')).toEqual({ side: 'left', align: 'start', sideOffset: 8, collisionPadding: 16 });
    expect(dockPopperProps('right').side).toBe('right');
  });
});
