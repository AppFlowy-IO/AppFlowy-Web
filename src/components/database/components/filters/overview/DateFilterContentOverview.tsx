import { DateFilter, DateFilterCondition, DateFormat, getDateFormat } from '@/application/database-yjs';
import dayjs from 'dayjs';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function DateFilterContentOverview ({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();

  const value = useMemo(() => {
    let startStr = '';
    let endStr = '';

    if (filter.start) {
      const end = filter.end ?? filter.start;
      const format = getDateFormat(DateFormat.Local);

      startStr = dayjs.unix(filter.start).format(format);
      endStr = dayjs.unix(end).format(format);
    }

    const timestamp = filter.timestamp ? dayjs.unix(filter.timestamp).format(getDateFormat(DateFormat.Local)) : '';

    switch (filter.condition) {
      case DateFilterCondition.DateStartsOn:
      case DateFilterCondition.DateEndsOn:
        return `: ${timestamp}`;
      case DateFilterCondition.DateStartsBefore:
      case DateFilterCondition.DateEndsAfter:
        return `: ${t('grid.dateFilter.choicechipPrefix.before')} ${timestamp}`;
      case DateFilterCondition.DateStartsAfter:
      case DateFilterCondition.DateEndsBefore:
        return `: ${t('grid.dateFilter.choicechipPrefix.after')} ${timestamp}`;
      case DateFilterCondition.DateStartsOnOrBefore:
      case DateFilterCondition.DateEndsOnOrAfter:
        return `: ${t('grid.dateFilter.choicechipPrefix.onOrBefore')} ${timestamp}`;
      case DateFilterCondition.DateStartsOnOrAfter:
      case DateFilterCondition.DateEndsOnOrBefore:
        return `: ${t('grid.dateFilter.choicechipPrefix.onOrAfter')} ${timestamp}`;
      case DateFilterCondition.DateStartsBetween:
      case DateFilterCondition.DateEndsBetween:
        return `: ${t('grid.dateFilter.choicechipPrefix.between')} ${startStr} - ${endStr}`;
      case DateFilterCondition.DateStartIsEmpty:
      case DateFilterCondition.DateEndIsEmpty:
        return `: ${t('grid.dateFilter.choicechipPrefix.isEmpty')}`;
      case DateFilterCondition.DateStartIsNotEmpty:
      case DateFilterCondition.DateEndIsNotEmpty:
        return `: ${t('grid.dateFilter.choicechipPrefix.isNotEmpty')}`;
      default:
        return '';
    }
  }, [filter, t]);

  return <>{value}</>;
}

export default DateFilterContentOverview;
