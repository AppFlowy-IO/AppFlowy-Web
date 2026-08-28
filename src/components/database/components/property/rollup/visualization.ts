import { renderColor } from '@/utils/color';

export function getRollupVisualizationColor(color: string) {
  return color === 'fill-default' ? 'var(--fill-default)' : renderColor(color);
}
