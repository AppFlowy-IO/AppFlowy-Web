import { toZonedTime } from 'date-fns-tz';

import { Log } from '@/utils/log';

import { DateFormat, TimeFormat, User } from './types';
import { UserTimezone } from './user-timezone.types';

export interface DefaultTimeSetting {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  startWeekOn: number;
}
/**
 * Predefined metadata keys to ensure consistency
 * This matches the Rust implementation on the backend
 */
export enum MetadataKey {
  Timezone = 'timezone',
  Language = 'language',
  DateFormat = 'date_format',
  TimeFormat = 'time_format',
  StartWeekOn = 'start_week_on',
  IconUrl = 'icon_url',
}

/**
 * Type-safe metadata value types for each key
 */
export interface MetadataValues {
  [MetadataKey.Timezone]: string | UserTimezone;
  [MetadataKey.Language]: string;
  [MetadataKey.DateFormat]: DateFormat;
  [MetadataKey.TimeFormat]: TimeFormat;
  [MetadataKey.StartWeekOn]: number;
  [MetadataKey.IconUrl]: string;
}

/**
 * Default values for metadata keys
 */
export const MetadataDefaults: Partial<MetadataValues> = {
  [MetadataKey.Timezone]: 'UTC',
  [MetadataKey.Language]: 'en',
  [MetadataKey.DateFormat]: DateFormat.US,
  [MetadataKey.TimeFormat]: TimeFormat.TwelveHour,
  [MetadataKey.StartWeekOn]: 0,
  [MetadataKey.IconUrl]: '',
};

/**
 * Helper class to build user metadata with type safety
 */
export class UserMetadataBuilder {
  private metadata: Partial<MetadataValues> = {};

  /**
   * Set timezone metadata
   */
  setTimezone(timezone: string | UserTimezone): this {
    this.metadata[MetadataKey.Timezone] = timezone;
    return this;
  }

  /**
   * Set language metadata
   */
  setLanguage(language: string): this {
    this.metadata[MetadataKey.Language] = language;
    return this;
  }

  /**
   * Set date format metadata
   */
  setDateFormat(format: DateFormat): this {
    this.metadata[MetadataKey.DateFormat] = format;
    return this;
  }

  /**
   * Set icon URL metadata
   */
  setIconUrl(url: string): this {
    this.metadata[MetadataKey.IconUrl] = url;
    return this;
  }

  /**
   * Build the final metadata object
   */
  build(): Partial<MetadataValues> {
    return { ...this.metadata };
  }
}

/**
 * Utility functions for metadata operations
 */
export const MetadataUtils = {
  /**
   * Detect user's preferred date format based on locale
   */
  detectDateFormat(locale: string = navigator.language): DateFormat {
    const region = locale.split('-')[1]?.toUpperCase() || locale.toUpperCase();

    // US format countries
    if (['US', 'CA', 'PH'].includes(region)) {
      return DateFormat.US;
    }

    // ISO format preference
    if (['SE', 'FI', 'JP', 'KR', 'CN', 'TW', 'HK'].includes(region)) {
      return DateFormat.ISO;
    }

    // Default to EU format for most other countries
    return DateFormat.DayMonthYear;
  },

  /**
   * Get browser language preference
   */
  getLanguagePreference(): string {
    // Get the primary language code (e.g., 'en' from 'en-US')
    return navigator.language.split('-')[0];
  },

  /**
   * Create metadata from timezone info
   */
  fromTimezoneInfo(info: { timezone: string; locale: string }): Partial<MetadataValues> {
    return new UserMetadataBuilder()
      .setTimezone(info.timezone)
      .build();
  },

  /**
   * Merge metadata objects with proper type handling
   */
  merge(...metadataObjects: Partial<MetadataValues>[]): Partial<MetadataValues> {
    return metadataObjects.reduce((acc, curr) => ({ ...acc, ...curr }), {});
  },

  /**
   * Validate metadata values
   */
  validate(metadata: Partial<MetadataValues>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate timezone if present - must be valid IANA timezone for chrono-tz compatibility
    if (metadata[MetadataKey.Timezone]) {
      const timezoneValue = metadata[MetadataKey.Timezone];

      // Extract the timezone string whether it's a string or UserTimezone object
      const timezone = typeof timezoneValue === 'string'
        ? timezoneValue
        : timezoneValue.timezone || timezoneValue.default_timezone;

      if (timezone) {
        try {
          // Use date-fns-tz to validate - if it can parse it, chrono-tz can too
          // Both use the same IANA timezone database
          const testDate = new Date();

          toZonedTime(testDate, timezone);
        } catch {
          errors.push(`Invalid IANA timezone for chrono-tz: ${timezone}`);
        }
      }
    }

    // Validate language code if present
    if (metadata[MetadataKey.Language]) {

      const lang = metadata[MetadataKey.Language];

      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
        errors.push(`Invalid language code: ${lang}`);
      }
    }

    // Validate icon URL if present
    if (metadata[MetadataKey.IconUrl]) {
      try {
        new URL(metadata[MetadataKey.IconUrl]);
      } catch {
        errors.push(`Invalid icon URL: ${metadata[MetadataKey.IconUrl]}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};

export function getUserIconUrl(
  user?: Pick<User, 'avatar' | 'metadata'> | null,
  workspaceMemberAvatar?: string | null
): string {
  if (!user) {
    Log.debug('[UserMetadata] getUserIconUrl invoked without user');
    return '';
  }

  // Priority 1: Workspace member avatar (if provided and not empty)
  const trimmedWorkspaceAvatar = workspaceMemberAvatar?.trim();

  if (trimmedWorkspaceAvatar && trimmedWorkspaceAvatar.length > 0) {
    Log.debug('[UserMetadata] resolved icon url from workspace member profile', {
      workspaceMemberAvatar: trimmedWorkspaceAvatar,
    });
    return trimmedWorkspaceAvatar;
  }

  // Priority 2: User profile avatar (metadata.icon_url)
  const metadata = user.metadata as Partial<MetadataValues> | undefined;
  const iconUrl = typeof metadata?.[MetadataKey.IconUrl] === 'string' ? metadata?.[MetadataKey.IconUrl]?.trim() : '';

  // Priority 3: User avatar fallback
  const fallbackAvatar = user.avatar?.trim() ?? '';
  const resolved = iconUrl?.length ? iconUrl : fallbackAvatar;

  Log.debug('[UserMetadata] resolved icon url from user profile', {
    metadataIconUrl: iconUrl,
    fallbackAvatar,
    resolved,
  });

  return resolved;
}
