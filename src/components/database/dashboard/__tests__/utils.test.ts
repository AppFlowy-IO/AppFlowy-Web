import { DatabaseViewLayout, ViewLayout } from '@/application/types';

import { DASHBOARD_CONTROL_GUTTER, WIDGET_HEADER_HEIGHT, WIDGET_MIN_VIEWPORT_HEIGHT } from '../constants';
import {
  databaseLayoutToViewLayout,
  getDashboardInlinePadding,
  getLayoutLabel,
  getWidgetCardCenter,
  getWidgetHeaderHeight,
  getWidgetViewportHeight,
} from '../utils';

describe('dashboard layout mapping', () => {
  it.each([
    [DatabaseViewLayout.Grid, ViewLayout.Grid],
    [DatabaseViewLayout.Board, ViewLayout.Board],
    [DatabaseViewLayout.Calendar, ViewLayout.Calendar],
    [DatabaseViewLayout.Chart, ViewLayout.Chart],
    [DatabaseViewLayout.List, ViewLayout.List],
    [DatabaseViewLayout.Gallery, ViewLayout.Gallery],
    [DatabaseViewLayout.Feed, ViewLayout.Feed],
    [DatabaseViewLayout.Form, ViewLayout.Form],
    [DatabaseViewLayout.Timeline, ViewLayout.Timeline],
    [DatabaseViewLayout.Dashboard, ViewLayout.Dashboard],
  ])('maps database layout %s to folder layout %s', (databaseLayout, viewLayout) => {
    expect(databaseLayoutToViewLayout(databaseLayout)).toBe(viewLayout);
  });

  it('falls back to Grid for unknown database layouts', () => {
    expect(databaseLayoutToViewLayout(null)).toBe(ViewLayout.Grid);
    expect(databaseLayoutToViewLayout(undefined)).toBe(ViewLayout.Grid);
    expect(databaseLayoutToViewLayout(42 as DatabaseViewLayout)).toBe(ViewLayout.Grid);
  });

  it('names every layout with a translation key and an English fallback', () => {
    expect(getLayoutLabel(ViewLayout.Dashboard)).toEqual({ key: 'dashboard.menuName', defaultValue: 'Dashboard' });
    expect(getLayoutLabel(ViewLayout.Timeline)).toEqual({ key: 'timeline.menuName', defaultValue: 'Timeline' });
    expect(getLayoutLabel(ViewLayout.Board)).toEqual({ key: 'board.menuName', defaultValue: 'Board' });
    expect(getLayoutLabel(ViewLayout.Grid)).toEqual({ key: 'grid.menuName', defaultValue: 'Grid' });
    expect(getLayoutLabel(ViewLayout.Document)).toEqual({ key: 'grid.menuName', defaultValue: 'Grid' });
  });
});

describe('widget chrome sizes', () => {
  it('reserves the 40px header band whenever titles are shown, in both modes', () => {
    expect(WIDGET_HEADER_HEIGHT).toBe(40);
    expect(getWidgetHeaderHeight({ showWidgetTitles: true })).toBe(40);
    expect(getWidgetHeaderHeight({ showWidgetTitles: false })).toBe(0);
  });

  it('hands the card height to the nested database: the row minus 46, or minus 12 without titles', () => {
    expect(getWidgetViewportHeight(360, { showWidgetTitles: true })).toBe(360 - 46);
    expect(getWidgetViewportHeight(360, { showWidgetTitles: false })).toBe(360 - 12);
  });

  it('never hands out less than the minimum viewport', () => {
    expect(getWidgetViewportHeight(40, { showWidgetTitles: true })).toBe(WIDGET_MIN_VIEWPORT_HEIGHT);
  });

  it('centres on the card: below the 40px header, or on the box when titles are hidden', () => {
    // The card spans 40px to H - 6px with titles, 6px to H - 6px without.
    expect(getWidgetCardCenter({ showWidgetTitles: true })).toBe('calc(40px + (100% - 46px) / 2)');
    expect(getWidgetCardCenter({ showWidgetTitles: false })).toBe('50%');
  });
});

describe('dashboard page inset', () => {
  it('floors both sides at the control gutter for users who can edit', () => {
    expect(DASHBOARD_CONTROL_GUTTER).toBe(44);
    expect(getDashboardInlinePadding({ paddingStart: 12, paddingEnd: 12, reserveControlGutter: true })).toEqual({
      paddingLeft: 44,
      paddingRight: 44,
    });
    expect(getDashboardInlinePadding({ paddingStart: 96, paddingEnd: 96, reserveControlGutter: true })).toEqual({
      paddingLeft: 96,
      paddingRight: 96,
    });
  });

  it('keeps the page padding for readers', () => {
    expect(getDashboardInlinePadding({ paddingStart: 12, paddingEnd: 12, reserveControlGutter: false })).toEqual({
      paddingLeft: 12,
      paddingRight: 12,
    });
    expect(getDashboardInlinePadding({ paddingStart: 96, paddingEnd: 12, reserveControlGutter: false })).toEqual({
      paddingLeft: 96,
      paddingRight: 12,
    });
  });
});
