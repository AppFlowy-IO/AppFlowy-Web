import { useCallback, useEffect, useRef, useState } from 'react';

import { getUserTimezoneInfo, TimezoneInfo } from '@/utils/timezone';

interface UseUserTimezoneOptions {
  onTimezoneChange?: (timezone: string) => void;
  updateInterval?: number; // in milliseconds, 0 to disable periodic checks
}

/**
 * Hook to manage user timezone information
 * Detects timezone once or monitors for changes based on updateInterval
 */
export function useUserTimezone(options: UseUserTimezoneOptions = {}) {
  const { onTimezoneChange, updateInterval = 0 } = options;
  const [timezoneInfo, setTimezoneInfo] = useState<TimezoneInfo | null>(null);
  const hasDetectedRef = useRef(false);

  const checkTimezone = useCallback(() => {
    const info = getUserTimezoneInfo();

    // For one-time detection
    if (!hasDetectedRef.current) {
      setTimezoneInfo(info);
      hasDetectedRef.current = true;
      sessionStorage.setItem('userTimezone', info.timezone);

      if (onTimezoneChange) {
        onTimezoneChange(info.timezone);
      }

      return true;
    }

    // For periodic monitoring (if enabled)
    if (updateInterval > 0) {
      const currentStored = sessionStorage.getItem('userTimezone');

      if (!currentStored || currentStored !== info.timezone) {
        setTimezoneInfo(info);
        sessionStorage.setItem('userTimezone', info.timezone);

        if (onTimezoneChange) {
          onTimezoneChange(info.timezone);
        }

        return true;
      }
    }

    return false;
  }, [onTimezoneChange, updateInterval]);

  useEffect(() => {
    checkTimezone();

    // Only set up monitoring if updateInterval > 0
    if (updateInterval > 0) {
      // Check when tab becomes visible
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          checkTimezone();
        }
      };

      // Check periodically
      const intervalId = setInterval(checkTimezone, updateInterval);

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        clearInterval(intervalId);
      };
    }
  }, [checkTimezone, updateInterval]);

  return timezoneInfo;
}