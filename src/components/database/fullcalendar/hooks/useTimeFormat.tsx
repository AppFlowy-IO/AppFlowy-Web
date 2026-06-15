import dayjs from 'dayjs';
import { useCallback } from 'react';

import { TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { useCurrentUser } from '@/components/main/app.hooks';

/**
 * Hook for consistent time formatting across calendar components
 */
export function useTimeFormat() {
  const currentUser = useCurrentUser();
  
  // Get user's time format preference, defaulting to 12-hour format
  const userTimeFormat = currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat ?? TimeFormat.TwelveHour;
  const use24Hour = userTimeFormat === TimeFormat.TwentyFourHour;
  
  /**
   * Format time display according to user preference
   * @param date - Date to format
   * @returns Formatted time string
   */
  const formatTimeDisplay = useCallback((date: Date): string => {
    const time = dayjs(date);
    const minutes = time.minute();

    if (use24Hour) {
      // 24-hour format: "14:00" or "14:30"
      return time.format('HH:mm');
    } else {
      // 12-hour format: "2 pm" or "2:30 pm" (lowercase)
      if (minutes === 0) {
        return time.format('h A').toLowerCase();
      } else {
        return time.format('h:mm A').toLowerCase();
      }
    }
  }, [use24Hour]);

  /**
   * Format time for slot labels in calendar view
   * @param date - Date to format
   * @returns Formatted time for slot labels
   */
  const formatSlotLabel = useCallback((date: Date) => {
    const hour = date.getHours();

    if (use24Hour) {
      return (
        <span>
          <span className='text-number'>{dayjs(date).format('HH:mm')}</span>
        </span>
      );
    } else {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      
      return (
        <span>
          <span className='text-number mr-1'>{displayHour}</span>
          <span className='text-slot'>{period}</span>
        </span>
      );
    }
  }, [use24Hour]);

  return {
    use24Hour,
    formatTimeDisplay,
    formatSlotLabel,
  };
}