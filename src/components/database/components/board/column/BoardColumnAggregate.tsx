import type { BoardColumnTint } from '@/application/database-yjs/board-column-color';
import { useBoardColumnCalculations } from '@/components/database/components/board/group/board-display-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The number beside a board column's name (WP09 §1.6): the card count, or the
 * board's column calculation with a "{calculation} of {property}" tooltip. A
 * calculation without a value shows nothing. Tinted columns draw it in their
 * text colour, others in the secondary text colour; tabular figures.
 */
export function BoardColumnAggregate({
  columnId,
  rowCount,
  tint,
}: {
  columnId: string;
  rowCount: number;
  tint?: BoardColumnTint;
}) {
  const calculations = useBoardColumnCalculations();
  const calculation = calculations?.get(columnId);
  const className = cn('text-sm font-normal leading-5 tabular-nums', !tint && 'text-text-secondary');
  const style = tint ? { color: tint.text } : undefined;

  if (!calculations) {
    return (
      <span
        className={className}
        data-kind='count'
        data-testid='board-column-aggregate'
        data-tint={tint?.index}
        style={style}
      >
        {rowCount}
      </span>
    );
  }

  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <span
          className={className}
          data-empty={calculation?.text ? undefined : 'true'}
          data-kind='calculation'
          data-testid='board-column-aggregate'
          data-tint={tint?.index}
          style={style}
        >
          {calculation?.text ?? ''}
        </span>
      </TooltipTrigger>
      {calculation?.tooltip ? <TooltipContent>{calculation.tooltip}</TooltipContent> : null}
    </Tooltip>
  );
}

export default BoardColumnAggregate;
