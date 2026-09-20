import dayjs from 'dayjs';
import { useEffect } from 'react';

import { YDatabaseFields, YDatabaseFilters } from '@/application/types';

import { isRelativeDateCondition } from '../fields/date/relativeDate';
import { getEffectiveFiltersSnapshot } from '../filter';

export function useRelativeDateFilterRefresh(
  filters: YDatabaseFilters | undefined,
  fields: YDatabaseFields | undefined,
  refresh: () => void
) {
  useEffect(() => {
    if (!filters || !fields) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let day = dayjs().format('YYYY-MM-DD');
    const hasRelative = (nodes: ReturnType<typeof getEffectiveFiltersSnapshot>): boolean =>
      nodes.some(
        (node) =>
          (node.condition !== undefined && isRelativeDateCondition(node.condition)) || hasRelative(node.children ?? [])
      );
    const schedule = () => {
      clearTimeout(timer);
      if (!hasRelative(getEffectiveFiltersSnapshot(filters, fields))) return;
      timer = setTimeout(() => {
        day = dayjs().format('YYYY-MM-DD');
        refresh();
        schedule();
      }, dayjs().add(1, 'day').startOf('day').valueOf() - Date.now() + 20);
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const today = dayjs().format('YYYY-MM-DD');

      if (today !== day) {
        day = today;
        refresh();
      }

      schedule();
    };

    schedule();
    filters.observeDeep(schedule);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      filters.unobserveDeep(schedule);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [filters, fields, refresh]);
}
