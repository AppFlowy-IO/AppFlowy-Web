export const REMINDER_OPTIONS = [
  { name: 'none', label: 'None', requiresTime: false },
  { name: 'atTimeOfEvent', label: 'At time of event', requiresTime: true },
  { name: 'fiveMinsBefore', label: '5 minutes before', requiresTime: true },
  { name: 'tenMinsBefore', label: '10 minutes before', requiresTime: true },
  { name: 'fifteenMinsBefore', label: '15 minutes before', requiresTime: true },
  { name: 'thirtyMinsBefore', label: '30 minutes before', requiresTime: true },
  { name: 'oneHourBefore', label: '1 hour before', requiresTime: true },
  { name: 'twoHoursBefore', label: '2 hours before', requiresTime: true },
  { name: 'onDayOfEvent', label: 'On day of event (09:00)', requiresTime: false },
  { name: 'oneDayBefore', label: '1 day before (09:00)', requiresTime: false },
  { name: 'twoDaysBefore', label: '2 days before (09:00)', requiresTime: false },
  { name: 'oneWeekBefore', label: '1 week before (09:00)', requiresTime: false },
] as const;

export type ReminderOptionName = (typeof REMINDER_OPTIONS)[number]['name'];

export function getReminderLabel(name: string): string {
  return REMINDER_OPTIONS.find((opt) => opt.name === name)?.label ?? 'None';
}

export function getFilteredReminderOptions(includeTime: boolean) {
  return REMINDER_OPTIONS.filter((opt) => !opt.requiresTime || includeTime);
}
