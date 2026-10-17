import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CalculationType, FieldType } from '@/application/database-yjs';
import { useCalculationFieldType } from '@/application/database-yjs/selector';
import { ICalculationCell } from '@/components/database/components/grid/grid-calculation-cell/CalculationCell';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from '@/components/ui/dropdown-menu';

function CalcationMenu({
  calculation,
  fieldId,
  open,
  onOpenChange,
  onClear,
  onChangeType,
}: {
  fieldId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  calculation?: ICalculationCell;
  onClear: () => void;
  onChangeType: (type: CalculationType) => void;
}) {
  // Formulas calculate like the native type of their result.
  const fieldType = useCalculationFieldType(fieldId);
  const { t } = useTranslation();

  const isCheckbox = fieldType === FieldType.Checkbox;
  const isChecklist = fieldType === FieldType.Checklist;

  const getLabel = useCallback(
    (type: CalculationType) => {
      switch (type) {
        case CalculationType.Average:
          return t('grid.calculationTypeLabel.average');
        case CalculationType.Max:
          return t('grid.calculationTypeLabel.max');
        case CalculationType.Count:
          return t('grid.calculationTypeLabel.count');
        case CalculationType.Min:
          return t('grid.calculationTypeLabel.min');
        case CalculationType.Sum:
          return t('grid.calculationTypeLabel.sum');
        case CalculationType.CountEmpty: {
          if (isCheckbox) {
            return t('grid.calculationTypeLabel.countUnchecked');
          }

          if (isChecklist) {
            return t('grid.calculationTypeLabel.countUncompleted');
          }

          return t('grid.calculationTypeLabel.countEmpty');
        }

        case CalculationType.CountNonEmpty: {
          if (isCheckbox) {
            return t('grid.calculationTypeLabel.countChecked');
          }

          if (isChecklist) {
            return t('grid.calculationTypeLabel.countCompleted');
          }

          return t('grid.calculationTypeLabel.countNonEmpty');
        }

        case CalculationType.CountUnique:
          return t('grid.calculationTypeLabel.countUnique');
        case CalculationType.PercentEmpty:
          return t('grid.calculationTypeLabel.percentEmpty');
        case CalculationType.PercentNotEmpty:
          return t('grid.calculationTypeLabel.percentNotEmpty');
        case CalculationType.Median:
          return t('grid.calculationTypeLabel.median');
        default:
          return '';
      }
    },
    [isCheckbox, isChecklist, t]
  );

  const options = useMemo(() => {
    const calculationTypes = [
      CalculationType.Count,
      CalculationType.CountEmpty,
      CalculationType.CountNonEmpty,
      CalculationType.CountUnique,
      CalculationType.PercentEmpty,
      CalculationType.PercentNotEmpty,
      CalculationType.Sum,
      CalculationType.Average,
      CalculationType.Min,
      CalculationType.Max,
      CalculationType.Median,
    ];

    const filteredCalculationTypes = calculationTypes.filter((c: CalculationType) => {
      switch (fieldType) {
        case FieldType.Number:
          return true;
        default:
          return [
            CalculationType.Count,
            CalculationType.CountEmpty,
            CalculationType.CountNonEmpty,
            CalculationType.CountUnique,
            CalculationType.PercentEmpty,
            CalculationType.PercentNotEmpty,
          ].includes(c);
      }
    });

    return filteredCalculationTypes.map((c: CalculationType) => ({
      value: c,
      label: getLabel(c),
    }));
  }, [fieldType, getLabel]);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div className={'absolute left-0 top-0 z-[-1] h-full w-full'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {calculation && (
          <DropdownMenuItem
            onSelect={() => {
              onClear();
            }}
          >
            {t('grid.calculationTypeLabel.none')}
          </DropdownMenuItem>
        )}
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={'w-full'}
            data-testid={`calculation-option-${option.value}`}
            onSelect={() => {
              onChangeType(option.value);
            }}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CalcationMenu;
