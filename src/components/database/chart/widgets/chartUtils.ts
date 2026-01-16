import { ChartDataItem } from '@/application/database-yjs/chart.type';

/**
 * Shared tooltip state interface for all chart types
 */
export interface TooltipState {
  active: boolean;
  item: ChartDataItem | null;
  x: number;
  y: number;
}

/**
 * Extended tooltip state for DonutChart with percentage
 */
export interface DonutTooltipState {
  active: boolean;
  item: (ChartDataItem & { percent?: number }) | null;
  x: number;
  y: number;
}

/**
 * Initial tooltip state
 */
export const INITIAL_TOOLTIP_STATE: TooltipState = {
  active: false,
  item: null,
  x: 0,
  y: 0,
};

/**
 * Format value for display (integer if whole number, otherwise 1 decimal)
 */
export function formatValue(value: number): string {
  return value === Math.round(value) ? value.toString() : value.toFixed(1);
}

/**
 * Generate integer tick values for axis (matching Flutter behavior)
 */
export function generateIntegerTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0];

  const maxTick = Math.ceil(maxValue);
  const ticks: number[] = [];

  for (let i = 0; i <= maxTick; i++) {
    ticks.push(i);
  }

  return ticks;
}

/**
 * Calculate bar width based on data count (matching Flutter implementation)
 */
export function calculateBarWidth(dataCount: number): number {
  if (dataCount <= 5) return 40;
  if (dataCount <= 10) return 30;
  if (dataCount <= 20) return 20;
  return 15;
}

/**
 * Calculate bar height based on data count for horizontal bar chart
 */
export function calculateBarHeight(dataCount: number): number {
  if (dataCount <= 5) return 48;
  if (dataCount <= 10) return 40;
  if (dataCount <= 20) return 32;
  return 28;
}

/**
 * Compute axis max - extend to ~2x max value for breathing room (matching Flutter)
 */
export function computeAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 4;

  const targetMax = maxValue * 2;

  if (targetMax <= 4) return 4;
  if (targetMax <= 5) return 5;
  if (targetMax <= 10) return 10;

  // For larger values, round up to nearest nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetMax)));
  const normalized = targetMax / magnitude;

  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}
