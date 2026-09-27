import { DateFormat, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { getDateFormat, renderDate } from '@/utils/time';

/** Minimal `t` shape so the helpers work with react-i18next and with test fakes. */
export type SettingsTranslate = (key: string) => string;

export function workspacePlanLabel(t: SettingsTranslate, plan: SubscriptionPlan | 'ai_local'): string {
  switch (plan) {
    case SubscriptionPlan.Free:
      return t('settings.billingPage.plan.freeLabel');
    case SubscriptionPlan.Pro:
      return t('settings.billingPage.plan.proLabel');
    case SubscriptionPlan.Team:
      return t('settings.planPage.planUsage.currentPlan.teamTitle');
    case SubscriptionPlan.AIMax:
      return t('settings.billingPage.addons.aiMax.label');
    case 'ai_local':
      return t('settings.billingPage.addons.aiOnDevice.label');
    default:
      return String(plan);
  }
}

export function intervalLabel(t: SettingsTranslate, interval: SubscriptionInterval): string {
  return interval === SubscriptionInterval.Year
    ? t('settings.billingPage.annualInterval')
    : t('settings.billingPage.monthlyInterval');
}

/** Fills the desktop-style `{}` placeholders in order. */
export function fillPlaceholders(template: string, ...values: string[]): string {
  return values.reduce((text, value) => text.replace('{}', value), template);
}

/** Fills a named desktop-style placeholder such as `{plan}` everywhere it appears. */
export function fillNamedPlaceholder(template: string, name: string, value: string): string {
  return template.split(`{${name}}`).join(value);
}

/** The user's date format preference, falling back like the account settings page does. */
export function userDateFormat(metadata?: Record<string, unknown>): DateFormat {
  return (Number(metadata?.[MetadataKey.DateFormat]) as DateFormat) || DateFormat.Local;
}

export function formatPeriodEnd(unixSeconds: number, dateFormat: DateFormat): string {
  return renderDate(unixSeconds, getDateFormat(dateFormat), true);
}
