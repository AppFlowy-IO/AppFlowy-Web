import { FC, useMemo } from 'react';
import { ReactComponent as CircleIcon } from '@/assets/icons/circle.svg';

export interface TagProps {
  color?: string;
  label?: string;
  badge?: string;
}

export const Tag: FC<TagProps> = ({ color, label, badge }) => {
  const className = useMemo(() => {
    const classList = ['rounded-[6px]', 'font-medium', 'flex items-center gap-0.5 py-0.5 px-1 max-w-full'];

    if (color) classList.push(`text-text-primary`);
    if (badge) classList.push('px-2 gap-1');
    return classList.join(' ');
  }, [color, badge]);

  return (
    <div
      style={{
        backgroundColor: color ? `var(${color})` : undefined,
      }}
      className={className}
    >
      {badge && (
        <CircleIcon
          style={{
            color: `var(${badge})`,
          }}
          className={`h-1.5 w-1.5`}
        />
      )}
      <div className={'truncate'}>{label}</div>
    </div>
  );
};
