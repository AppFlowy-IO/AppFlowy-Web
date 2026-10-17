import { useMemo } from 'react';

export function LinearProgressWithLabel({
  value,
  count,
  selectedCount,
}: {
  value: number;
  count: number;
  selectedCount: number;
}) {
  const result = useMemo(() => `${Math.round(value * 100)}%`, [value]);

  const options = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      checked: i < selectedCount,
    }));
  }, [count, selectedCount]);

  const isSplit = count < 6;

  return (
    <div className={'flex w-full items-center'}>
      <div className={`flex flex-1  items-center justify-between px-1 ${isSplit ? 'gap-0.5' : ''}`}>
        {count > 0 ? (
          options.map((option) => (
            <span
              style={{
                width: `${Math.round(100 / count)}%`,
                backgroundColor:
                  value < 1
                    ? option.checked
                      ? 'var(--fill-theme-thick)'
                      : 'var(--fill-info-light)'
                    : 'var(--fill-success-thick)',
              }}
              className={`h-[4px] ${isSplit ? 'rounded-full' : ''} `}
              key={option.id}
            />
          ))
        ) : (
          <span className={'h-[4px] w-full rounded-full bg-fill-theme-select'} />
        )}
      </div>
      <div className={'checklist-progress-label min-w-[30px] text-center text-text-secondary'}>{result}</div>
    </div>
  );
}

export default LinearProgressWithLabel;
