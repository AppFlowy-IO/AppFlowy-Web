import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, Edge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NUMBER_COLOR_OPERATORS } from '@/application/database-yjs/chart-config';
import { NumberColorRule } from '@/application/database-yjs/chart.type';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { cn } from '@/lib/utils';

import { numberColorVar } from '../../widgets/numberChartUtils';

import { NumberColorChips, useNumberColorLabel } from './NumberColorChips';

export type NumberRuleExpansion = 'operator' | 'color' | null;

export interface NumberRuleEditorProps {
  rule: NumberColorRule;
  index: number;
  instanceId: symbol;
  /** Which inline list of this rule is open; only one in the panel at a time. */
  expanded: NumberRuleExpansion;
  onExpand: (expansion: NumberRuleExpansion) => void;
  onChange: (rule: NumberColorRule) => void;
  onDelete: () => void;
  onMove: (step: -1 | 1) => void;
}

function RuleValueInput({ index, value, onCommit }: { index: number; value: number; onCommit: (value: number) => void }) {
  const stored = String(value);
  const [draft, setDraft] = useState(stored);
  const [previous, setPrevious] = useState(stored);

  if (stored !== previous) {
    setPrevious(stored);
    setDraft(stored);
  }

  const commit = () => {
    const number = draft.trim() === '' ? NaN : Number(draft);

    // Invalid input reverts.
    if (!Number.isFinite(number)) {
      setDraft(stored);
      return;
    }

    if (number !== value) onCommit(number);
  };

  return (
    <input
      data-testid={`chart-number-rule-${index}-value`}
      inputMode='decimal'
      value={draft}
      className='h-7 w-full rounded-[6px] border border-border-primary bg-surface-primary px-2 text-sm leading-5 tabular-nums text-text-primary outline-none focus:border-border-theme-thick'
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * One dynamic color rule (WP11 §1.12): "If value" + operator + delete, the
 * value, and its color. The operator and the color open inline lists under
 * themselves. A drag handle (or Alt+↑ / Alt+↓) reorders the rules.
 */
export function NumberRuleEditor({
  rule,
  index,
  instanceId,
  expanded,
  onExpand,
  onChange,
  onDelete,
  onMove,
}: NumberRuleEditorProps) {
  const { t } = useTranslation();
  const colorLabel = useNumberColorLabel();
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const operator = NUMBER_COLOR_OPERATORS.find((item) => item.value === rule.operator);

  useEffect(() => {
    const element = boxRef.current;
    const dragHandle = handleRef.current;

    if (!element || !dragHandle) return;
    return combine(
      draggable({ element, dragHandle, getInitialData: () => ({ instanceId, id: rule.id, index }) }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.instanceId === instanceId,
        getData: ({ input }) => attachClosestEdge({ id: rule.id, index }, { element, input, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self }) => setEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      })
    );
  }, [instanceId, rule.id, index]);

  return (
    <div
      ref={boxRef}
      data-testid={`chart-number-rule-${index}`}
      data-parity-id='dash-number-color-rule'
      className='group relative mx-2 flex flex-col gap-1.5 rounded-[8px] bg-fill-content-hover p-2'
      onKeyDown={(event: KeyboardEvent) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}
    >
      {edge ? (
        <span
          aria-hidden='true'
          className={cn('absolute left-1 right-1 h-0.5 rounded bg-dash-accent', edge === 'top' ? '-top-1' : '-bottom-1')}
        />
      ) : null}
      <div className='flex h-6 items-center gap-1'>
        <span
          ref={handleRef}
          data-testid={`chart-number-rule-${index}-handle`}
          className='-ml-1 flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-icon-tertiary opacity-0 group-hover:opacity-100'
        >
          <DragIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-number-color-rule__drag-icon' />
        </span>
        <span className='text-sm leading-5 text-text-secondary'>
          {t('chart.numberColor.ifValue', { defaultValue: 'If value' })}
        </span>
        <button
          type='button'
          aria-expanded={expanded === 'operator'}
          data-testid={`chart-number-rule-${index}-operator`}
          data-operator={rule.operator}
          className='flex h-6 items-center gap-0.5 rounded-[6px] px-1.5 text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
          onClick={() => onExpand(expanded === 'operator' ? null : 'operator')}
        >
          {operator?.symbol ?? rule.operator}
          <ChevronDownIcon aria-hidden='true' className='h-3 w-3 text-icon-tertiary' />
        </button>
        <span className='flex-1' />
        <button
          type='button'
          aria-label={t('chart.numberColor.deleteRule', { defaultValue: 'Delete rule' })}
          data-testid={`chart-number-rule-${index}-delete`}
          className='flex h-6 w-6 items-center justify-center rounded-[6px] text-dash-tool-icon outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
          onClick={onDelete}
        >
          <DeleteIcon aria-hidden='true' className='h-4 w-4' />
        </button>
      </div>
      {expanded === 'operator' ? (
        <div role='menu' className='flex flex-col'>
          {NUMBER_COLOR_OPERATORS.map((item) => (
            <button
              key={item.value}
              type='button'
              role='menuitemradio'
              aria-checked={item.value === rule.operator}
              data-testid={`chart-number-rule-${index}-operator-${item.value}`}
              className='flex h-7 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
              onClick={() => {
                onChange({ ...rule, operator: item.value });
                onExpand(null);
              }}
            >
              <span className='flex-1'>{t(item.labelKey, { defaultValue: item.fallback })}</span>
              {item.value === rule.operator ? <CheckIcon aria-hidden='true' className='h-4 w-4 text-icon-primary' /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <RuleValueInput index={index} value={rule.value} onCommit={(value) => onChange({ ...rule, value })} />
      <button
        type='button'
        aria-expanded={expanded === 'color'}
        data-testid={`chart-number-rule-${index}-color`}
        data-color={rule.color}
        className='flex h-7 items-center gap-2 rounded-[6px] px-1 text-left text-sm leading-5 outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
        onClick={() => onExpand(expanded === 'color' ? null : 'color')}
      >
        <span className='text-text-secondary'>{t('chart.settings.color', { defaultValue: 'Color' })}</span>
        <span aria-hidden='true' className='h-4 w-4 shrink-0 rounded-[4px]' style={{ backgroundColor: numberColorVar(rule.color) }} />
        <span className='min-w-0 flex-1 truncate text-text-primary'>{colorLabel(rule.color)}</span>
        <ChevronDownIcon aria-hidden='true' className='h-3 w-3 text-icon-tertiary' />
      </button>
      {expanded === 'color' ? (
        <NumberColorChips
          selected={rule.color}
          testIdPrefix={`chart-number-rule-${index}-color`}
          onSelect={(color) => {
            onChange({ ...rule, color });
            onExpand(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default NumberRuleEditor;
