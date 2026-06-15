import { isNaN } from 'lodash-es';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { currencyFormaterMap, FieldType, parseNumberTypeOptions, useFieldSelector } from '@/application/database-yjs';
import { CalculationType } from '@/application/database-yjs/database.type';
import EnhancedBigStats from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { YjsDatabaseKey } from '@/application/types';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';

export interface ICalculationCell {
  value: string;
  fieldId: string;
  id: string;
  type: CalculationType;
}

export interface CalculationCellProps {
  cell?: ICalculationCell;
}

export function CalculationCell ({ cell }: CalculationCellProps) {
  const { t } = useTranslation();

  const fieldId = cell?.fieldId || '';

  const { field, clock } = useFieldSelector(fieldId);

  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

  const format = useMemo(
    () =>
      field && Number(field?.get(YjsDatabaseKey.type)) === FieldType.Number
        ? parseNumberTypeOptions(field).format
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field, clock],
  );
  const [num, setNum] = useState<string>();

  const prefix = useMemo(() => {
    if (!cell) return '';

    switch (cell.type) {
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
        if (fieldType === FieldType.Checkbox) {
          return t('grid.calculationTypeLabel.countUncheckedShort');
        }

        if (fieldType === FieldType.Checklist) {
          return t('grid.calculationTypeLabel.countUncompletedShort');
        }

        return t('grid.calculationTypeLabel.countEmptyShort');
      }

      case CalculationType.CountNonEmpty: {
        if (fieldType === FieldType.Checkbox) {
          return t('grid.calculationTypeLabel.countCheckedShort');
        }

        if (fieldType === FieldType.Checklist) {
          return t('grid.calculationTypeLabel.countCompletedShort');
        }

        return t('grid.calculationTypeLabel.countNonEmptyShort');
      }

      case CalculationType.Median:
        return t('grid.calculationTypeLabel.median');
      default:
        return '';
    }
  }, [cell, fieldType, t]);

  const isCount = useMemo(() => {
    if (!cell) return false;

    return (
      cell.type === CalculationType.Count ||
      cell.type === CalculationType.CountEmpty ||
      cell.type === CalculationType.CountNonEmpty
    );
  }, [cell]);

  useEffect(() => {
    if (!prefix) return;
    const readValue = () => {
      const value = cell?.value;

      if (value === undefined || isNaN(parseInt(value))) return '0';

      const data = EnhancedBigStats.parse(value) || '0';

      const isInteger = Number.isInteger(data);

      if (isInteger) {
        if (format && currencyFormaterMap[format] && !isCount) {
          return currencyFormaterMap[format](BigInt(data));
        }

        return data.toString();
      }

      const res = parseFloat(data).toFixed(2).replace(/(\.[0-9]*[1-9])0+$/, '$1').replace(/\.0+$/, '');

      if (format && currencyFormaterMap[format] && !isCount) {
        return currencyFormaterMap[format](parseFloat(res));
      }

      return res;
    };

    setNum(readValue());
  }, [cell?.value, format, prefix, isCount]);

  return (
    <Tooltip delayDuration={1500}>
      <TooltipTrigger asChild>
        <div className={'h-full text-sm w-full overflow-hidden items-center px-2 text-right flex gap-[10px] uppercase leading-[36px] text-text-secondary'}>
          <span className={'flex-1 text-xs'}>{prefix}</span>
          <span className={'font-medium text-text-primary truncate'}>{num}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {prefix}
        <TooltipShortcut>{num}</TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  );
}

export default CalculationCell;
