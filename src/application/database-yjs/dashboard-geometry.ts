/**
 * The one web definition of the dashboard layout limits, geometry, typography
 * and motion. Every value is copied from `dashboard-parity/tokens.json` (the
 * file desktop reads too) and `dashboard-tokens.test.ts` fails when the two
 * disagree, so change the fixture and this file together. Pure: no React, no
 * DOM, so playwright helpers import it as well.
 */

/** Notion parity: a dashboard holds at most 12 widgets, 4 per row. */
export const DASHBOARD_MAX_WIDGETS = 12;
export const DASHBOARD_MAX_WIDGETS_PER_ROW = 4;
/** Widget widths are shares of a 12-column grid; a row's widths always sum to this. */
export const DASHBOARD_GRID_COLUMNS = 12;
export const DASHBOARD_MIN_ROW_HEIGHT = 240;
export const DASHBOARD_DEFAULT_ROW_HEIGHT = 360;
export const DASHBOARD_MAX_ROW_HEIGHT = 1200;
/** Row heights snap to this step (drag and keyboard). */
export const DASHBOARD_ROW_HEIGHT_SNAP = 20;
/** A widget narrower than this wraps to its own line (WP02). */
export const DASHBOARD_MIN_WIDGET_WIDTH = 240;

/** CSS px. Exactly `tokens.json` `geometry`. */
export const DASHBOARD_GEOMETRY = {
  grid: { columnGap: 12, rowGap: 16, topBand: 12, minWidgetColumns: 2 },
  widget: {
    boxPaddingTop: 0,
    boxPaddingInline: 6,
    boxPaddingBottom: 6,
    boxRadius: 16,
    headerHeight: 40,
    headerPaddingInline: 10,
    headerPaddingBlock: 2,
    cardRadius: 12,
    cardInset: 46,
    titlePill: { paddingBlock: 4, paddingInline: 10, radius: 20, gap: 4 },
    toolButton: { size: 24, radius: 6, icon: 16 },
    boxBleed: 6,
    hiddenTitleCapsuleInset: 8,
  },
  toolbar: {
    button: { size: 28, radius: 6, padding: 6 },
  },
  row: { controlSize: 24, controlOffset: 30, controlGutterMin: 44, addNewRowSize: 28 },
  selection: { outlineWidth: 2, radius: 16 },
  dnd: { indicatorWidth: 2 },
  resize: {
    hitWidth: 24,
    pillWidthHover: 2,
    pillWidthActive: 3,
    pillMin: 40,
    pillFraction: 0.33,
    pillMax: 60,
    bandHover: 4,
    bandActive: 2,
  },
  page: { compactBreakpoint: 640, compactInset: 24 },
  unsavedDot: 6,
  menu: { width: 220, radius: 10, padding: 4, itemHeight: 28, itemRadius: 6, itemPaddingInline: 8 },
  popover: { globalFilterWidth: 290, pickerWidth: 300, widgetSettingsWidth: 300, radius: 10 },
  tooltip: {
    radius: 8,
    maxWidth: 300,
    maxHeight: 375,
    rowPaddingBlock: 10,
    rowPaddingInline: 12,
    gap: 16,
    swatch: 8,
    swatchRadius: 1,
  },
  // Chart drill-down dialog (WP13).
  drilldown: {
    width: 800,
    height: 496,
    radius: 12,
    viewportMargin: 16,
    paddingInline: 24,
    titleTop: 18,
    toolsInsetRight: 28,
    toolButton: 28,
    dismissSize: 24,
    chipsTop: 64,
    chipHeight: 24,
    chipRadius: 12,
    tableTop: 96,
    rowHeight: 36,
    skeletonRows: 6,
    searchWidth: 200,
    openPillHeight: 22,
    menuWidth: 220,
    savePopoverWidth: 280,
  },
  // Record side peek opened from a dashboard (WP13).
  sidePeek: {
    defaultWidth: 640,
    defaultFraction: 0.45,
    minWidth: 420,
    maxWidth: 1000,
    viewportReserve: 240,
    headerHeight: 44,
    resizeHit: 6,
    resizeStep: 20,
    webTop: 48,
  },
} as const;

/** Size and line height in CSS px, weight as a CSS font weight. Exactly `tokens.json` `typography`. */
export const DASHBOARD_TYPOGRAPHY = {
  widgetTitle: { size: 12, lineHeight: 16, weight: 500 },
  tick: { size: 12, lineHeight: 16, weight: 400 },
  dataLabel: { size: 12, lineHeight: 16, weight: 400 },
  donutOutsideLabel: { size: 10, lineHeight: 14, weight: 400 },
  tooltip: { size: 12, lineHeight: 18, weight: 400 },
  numberCaption: { size: 16, lineHeight: 24, weight: 600 },
  // clamp(minSize, containerFactor × container width, maxSize).
  numberValue: { minSize: 40, maxSize: 60, containerFactor: 0.16, lineHeightRatio: 1.1, weight: 600, tabular: true },
  // clamp(minSize, radiusFactor × outer radius, maxSize).
  donutTotal: { minSize: 24, maxSize: 56, radiusFactor: 0.45, weight: 700 },
  donutCaption: { size: 12, lineHeight: 16, weight: 400 },
  menu: { size: 14, lineHeight: 20, weight: 400 },
  pill: { size: 14, lineHeight: 20, weight: 400 },
  drilldownTitle: { size: 17, lineHeight: 24, weight: 700 },
  drilldownCell: { size: 14, lineHeight: 20, weight: 400 },
  drilldownCount: { size: 14, lineHeight: 20, weight: 400 },
  drilldownOpen: { size: 11, lineHeight: 16, weight: 600 },
} as const;

/** Exactly `tokens.json` `motion`. */
export const DASHBOARD_MOTION = { fastMs: 150, reflowMs: 200, easing: 'ease-in-out' } as const;

/**
 * Chart frame, marks, legend and axis geometry in CSS px (WP10). Exactly the
 * geometry leaves of `tokens.json` `chart`; the palettes live in `chart.type.ts`.
 */
export const DASHBOARD_CHART_GEOMETRY = {
  /** Insets of the chart frame from the card edge when the chart is a dashboard widget. */
  insetWidget: { top: 12, right: 16, bottom: 12, left: 12 },
  bar: { minWidth: 8, maxWidth: 16, slotFraction: 0.35, radius: 2 },
  line: { strokeWidth: 1.5, gradientTopAlpha: 0.2, activeDotRadius: 4 },
  donut: {
    thicknessFactor: 0.14,
    minThickness: 6,
    maxOuter: 140,
    labelGutter: 24,
    minOuterForLabels: 80,
    minShareForLabel: 3,
    leaderRadial: 10,
    leaderHorizontal: 8,
  },
  legend: {
    swatch: 8,
    swatchRadius: 2,
    lineGlyph: [12, 2],
    gapX: 16,
    gapY: 4,
    lineHeight: 16,
    maxLines: 2,
    narrowWidth: 160,
    maxLabelWidth: 160,
  },
  axis: { tickGap: 8, rotatedMaxLabel: 80, minSlotForRotation: 24, minLabelSpacing: 16, headroom: 0.08, maxTicks: 5 },
  hoverBandRadius: 4,
  skeleton: { barWidth: 8, gap: 6, heights: [18, 30, 24, 36, 14] },
} as const;

/**
 * Board column tint (WP09): the `--block-*-color-N` index for each select
 * option color, by `SelectOptionColor` order (desktop
 * `_selectOptionColorToAFColorMap`). Exactly `tokens.json`
 * `boardColumnTintBlockIndex`.
 */
export const DASHBOARD_BOARD_COLUMN_TINT_BLOCK_INDEX = [
  14, 16, 18, 2, 4, 6, 8, 10, 12, 20, 14, 16, 18, 2, 4, 6, 8, 10, 12, 20,
] as const;

// Flat aliases for the values later packages import by name.
/** WP02 switches `constants.ts` `DASHBOARD_COLUMN_GAP` to this. */
export const DASHBOARD_COLUMN_GAP_PX = DASHBOARD_GEOMETRY.grid.columnGap;
/** WP03: replaces `WIDGET_TITLE_HEIGHT` and `WIDGET_EDIT_HEADER_HEIGHT`. */
export const DASHBOARD_WIDGET_HEADER_HEIGHT = DASHBOARD_GEOMETRY.widget.headerHeight;
/** WP02, WP03: the widget box bleeds this far past the content column. */
export const DASHBOARD_WIDGET_BOX_BLEED = DASHBOARD_GEOMETRY.widget.boxBleed;
/** WP04: row controls are centred this far outside the content column. */
export const DASHBOARD_ROW_CONTROL_OFFSET = DASHBOARD_GEOMETRY.row.controlOffset;
export const DASHBOARD_ROW_CONTROL_SIZE = DASHBOARD_GEOMETRY.row.controlSize;
export const DASHBOARD_ADD_ROW_BUTTON_SIZE = DASHBOARD_GEOMETRY.row.addNewRowSize;
export const DASHBOARD_DROP_INDICATOR_WIDTH = DASHBOARD_GEOMETRY.dnd.indicatorWidth;
