import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createNumberColorRule } from '@/application/database-yjs/chart-config';
import { ChartNumberColor, NumberColorRule, NumberConditionalColor } from '@/application/database-yjs/chart.type';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';

import { numberColorVar } from '../../widgets/numberChartUtils';
import { ChartSettingsRow } from '../ChartSettingsRow';
import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

import { NumberColorChips, useNumberColorLabel } from './NumberColorChips';
import { NumberRuleEditor, NumberRuleExpansion } from './NumberRuleEditor';

export interface NumberColorPageProps {
  title: string;
  numberColor: string;
  conditional: NumberConditionalColor | null;
  onNumberColorChange: (color: ChartNumberColor) => void;
  onConditionalChange: (conditional: NumberConditionalColor) => void;
  onBack: () => void;
}

type Expansion = { rule: number; part: Exclude<NumberRuleExpansion, null> } | { rule: 'else' } | null;

/** A new rule: greater than 0 in green, under an `ncr:` id. */
export function newNumberColorRule(): NumberColorRule {
  return createNumberColorRule(`ncr:${nanoid(8)}`);
}

/**
 * The Number card's Color page (WP11 §1.12): the static color chips, then
 * the "Dynamic color" toggle; when it is on, the rule list, "+ Add rule" and
 * the Else color replace the chips. Every edit writes the whole conditional
 * object (the writer keeps unknown keys by rule id).
 */
export function NumberColorPage({
  title,
  numberColor,
  conditional,
  onNumberColorChange,
  onConditionalChange,
  onBack,
}: NumberColorPageProps) {
  const { t } = useTranslation();
  const colorLabel = useNumberColorLabel();
  const [instanceId] = useState(() => Symbol('chart-number-rules'));
  const [expansion, setExpansion] = useState<Expansion>(null);
  const enabled = Boolean(conditional?.enabled);
  const rules = conditional?.rules ?? [];
  const latestRef = useRef<NumberConditionalColor | null>(conditional);

  // Written after commit, not during render: a write merges into what was
  // rendered last, never a render React discarded.
  useLayoutEffect(() => {
    latestRef.current = conditional;
  }, [conditional]);

  const write = useCallback(
    (next: Partial<NumberConditionalColor>) => {
      const current = latestRef.current ?? { enabled: false, rules: [] };

      onConditionalChange({ ...current, ...next });
    },
    [onConditionalChange]
  );

  const setRules = useCallback(
    (next: NumberColorRule[]) => {
      write({ rules: next });
    },
    [write]
  );

  const moveRule = useCallback(
    (startIndex: number, finishIndex: number) => {
      const current = latestRef.current?.rules ?? [];

      if (finishIndex < 0 || finishIndex >= current.length || finishIndex === startIndex) return;
      setRules(reorder({ list: current, startIndex, finishIndex }));
      setExpansion(null);
    },
    [setRules]
  );

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => source.data.instanceId === instanceId,
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets[0];

          if (!target) return;
          const startIndex = Number(source.data.index);

          moveRule(
            startIndex,
            getReorderDestinationIndex({
              startIndex,
              indexOfTarget: Number(target.data.index),
              closestEdgeOfTarget: extractClosestEdge(target.data),
              axis: 'vertical',
            })
          );
        },
      }),
    [instanceId, moveRule]
  );

  const toggleDynamic = (on: boolean) => {
    setExpansion(null);
    if (on) {
      const current = latestRef.current;

      write({ enabled: true, rules: current && current.rules.length > 0 ? current.rules : [newNumberColorRule()] });
      return;
    }

    // Turning it off keeps the rules for next time.
    write({ enabled: false });
  };

  const elseColor = conditional?.elseColor;
  const elseOpen = expansion !== null && 'rule' in expansion && expansion.rule === 'else';

  return (
    <ChartSettingsSubPage title={title} onBack={onBack}>
      {!enabled ? (
        <NumberColorChips selected={numberColor} testIdPrefix='chart-number-color' onSelect={onNumberColorChange} />
      ) : null}
      <div className='mx-2 my-1 h-px shrink-0 bg-border-primary' role='separator' />
      <ChartSettingsRow
        rowId='number_dynamic_color'
        testId='chart-number-dynamic-color'
        label={t('chart.numberColor.dynamicColor', { defaultValue: 'Dynamic color' })}
        toggle={{ checked: enabled, onChange: toggleDynamic }}
      />
      {enabled ? (
        <div className='flex flex-col gap-2 pt-1' data-testid='chart-number-rules'>
          {rules.map((rule, index) => (
            <NumberRuleEditor
              key={rule.id}
              rule={rule}
              index={index}
              instanceId={instanceId}
              expanded={expansion && 'part' in expansion && expansion.rule === index ? expansion.part : null}
              onExpand={(part) => setExpansion(part ? { rule: index, part } : null)}
              onChange={(next) => setRules(rules.map((item, position) => (position === index ? next : item)))}
              onDelete={() => {
                setExpansion(null);
                setRules(rules.filter((_, position) => position !== index));
              }}
              onMove={(step) => moveRule(index, index + step)}
            />
          ))}
          <button
            type='button'
            data-testid='chart-number-add-rule'
            className='mx-2 flex h-7 items-center gap-2 rounded-[6px] px-2 text-sm leading-5 text-text-secondary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
            onClick={() => {
              setExpansion(null);
              setRules([...rules, newNumberColorRule()]);
            }}
          >
            <PlusIcon aria-hidden='true' className='h-4 w-4' />
            {t('chart.numberColor.addRule', { defaultValue: 'Add rule' })}
          </button>
          <button
            type='button'
            aria-expanded={elseOpen}
            data-testid='chart-number-else-color'
            data-color={elseColor ?? ''}
            className='mx-2 flex h-7 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
            onClick={() => setExpansion(elseOpen ? null : { rule: 'else' })}
          >
            <span className='text-text-secondary'>{t('chart.numberColor.else', { defaultValue: 'Else' })}</span>
            <span
              aria-hidden='true'
              className='h-4 w-4 shrink-0 rounded-[4px]'
              style={{ backgroundColor: numberColorVar(elseColor ?? numberColor) }}
            />
            <span className='min-w-0 flex-1 truncate text-text-primary'>
              {elseColor === undefined
                ? t('chart.numberColor.sameAsColor', { defaultValue: 'Same as Color' })
                : colorLabel(elseColor)}
            </span>
            <ChevronDownIcon aria-hidden='true' className='h-3 w-3 text-icon-tertiary' />
          </button>
          {elseOpen ? (
            <NumberColorChips
              selected={elseColor ?? null}
              testIdPrefix='chart-number-else-color'
              onSelect={(color) => {
                setExpansion(null);
                write({ elseColor: color });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </ChartSettingsSubPage>
  );
}

export default NumberColorPage;
