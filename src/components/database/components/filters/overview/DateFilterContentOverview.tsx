import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DateFilter, DateFilterCondition, } from '@/application/database-yjs';
import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat } from '@/utils/time';

function DateFilterContentOverview({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const value = useMemo(() => {
    let startStr = '';
    let endStr = '';

    if (filter.start) {
      const end = filter.end ?? filter.start;
      const format = getDateFormat(DateFormat.Local);

      startStr = dayjs.unix(filter.start).format(format);
      endStr = dayjs.unix(end).format(format);
    }

    const dateFormat = currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat | DateFormat.Local;
    const timestamp = filter.timestamp ? dayjs.unix(filter.timestamp).format(getDateFormat(dateFormat)) : '';

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
      case DateFilterCondition.DateStartsToday:
      case DateFilterCondition.DateEndsToday:
        return `: ${t('relativeDates.today')}`;
      case DateFilterCondition.DateStartsYesterday:
      case DateFilterCondition.DateEndsYesterday:
        return `: ${t('relativeDates.yesterday')}`;
      case DateFilterCondition.DateStartsTomorrow:
      case DateFilterCondition.DateEndsTomorrow:
        return `: ${t('relativeDates.tomorrow')}`;
      case DateFilterCondition.DateStartsThisWeek:
      case DateFilterCondition.DateEndsThisWeek:
        return `: ${t('relativeDates.thisWeek')}`;
      case DateFilterCondition.DateStartsLastWeek:
      case DateFilterCondition.DateEndsLastWeek:
        return `: ${t('relativeDates.lastWeek')}`;
      case DateFilterCondition.DateStartsNextWeek:
      case DateFilterCondition.DateEndsNextWeek:
        return `: ${t('relativeDates.nextWeek')}`;
      default:
        return '';
    }
  }, [filter, t, currentUser?.metadata]);

  return <>{value}</>;
}

export default DateFilterContentOverview;
