import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';

const RING_RADIUS = 6.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The "Show as" Bar / Ring rendering shared by Rollup and Formula cells.
 * `ratio` is already clamped to [0, 1]; `color` is a resolved CSS color.
 */
export function ShowAsVisualization({
  type,
  ratio,
  color,
  value,
  showValue,
  testIdPrefix = 'rollup',
}: {
  type: RollupShowAsType;
  ratio: number;
  color: string;
  value: string;
  showValue: boolean;
  testIdPrefix?: string;
}) {
  if (type === RollupShowAsType.Number) return null;

  if (type === RollupShowAsType.Bar) {
    return (
      <div
        role={'progressbar'}
        aria-label={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={value}
        className={'flex w-full items-center gap-2'}
        data-testid={`${testIdPrefix}-bar-visualization`}
      >
        {showValue ? <span className={'shrink-0'}>{value}</span> : null}
        <div className={'h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-fill-secondary'}>
          <div className={'h-full rounded-full'} style={{ background: color, width: `${ratio * 100}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className={'flex items-center gap-2'} data-testid={`${testIdPrefix}-ring-visualization`}>
      {showValue ? <span>{value}</span> : null}
      <svg
        className={'h-4 w-4 -rotate-90'}
        viewBox={'0 0 16 16'}
        role={'img'}
        aria-label={`${Math.round(ratio * 100)}%`}
      >
        <circle cx={'8'} cy={'8'} r={RING_RADIUS} fill={'none'} stroke={'var(--fill-secondary)'} strokeWidth={'3'} />
        <circle
          cx={'8'}
          cy={'8'}
          r={RING_RADIUS}
          fill={'none'}
          stroke={color}
          strokeWidth={'3'}
          strokeLinecap={'round'}
          strokeDasharray={`${ratio * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        />
      </svg>
    </div>
  );
}
