import {
  FeatureValue,
  PricingCatalog,
  PricingFeature,
  PricingPlan,
  PricingPrice,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';

/** Minimal `t` shape so the helpers work with react-i18next and with test fakes. */
export type PricingTranslate = (key: string, options?: Record<string, unknown>) => string;

const WORKSPACE_PLAN_KIND = 'workspace_plan';
const FEATURE_LABEL_KEY_PREFIX = 'subscribe.feature.';

const SUBSCRIPTION_PLAN_IDS = new Set<string>(Object.values(SubscriptionPlan));

const UNIT_VALUE_KEYS: Record<string, string> = {
  members: 'subscribe.value.upTo',
  guests: 'subscribe.value.upTo',
  gb: 'subscribe.value.gb',
  mb: 'subscribe.value.mb',
  days: 'subscribe.value.days',
  hours: 'subscribe.value.hours',
  images_per_month: 'subscribe.value.imagesPerMonth',
  responses_lifetime: 'subscribe.value.responsesLifetime',
  images_lifetime: 'subscribe.value.imagesLifetime',
  workspaces: 'subscribe.value.workspaces',
  forms: 'subscribe.value.forms',
};

/**
 * Formats cents as the short dollar string used across the pricing UI, matching
 * the desktop client: 1250 -> `$12.5`, 1000 -> `$10`, 1299 -> `$12.99`.
 * With `perMonthFromYearly` a yearly total becomes its monthly equivalent:
 * 12000 -> `$10`.
 */
export function formatPriceCents(cents: number, options: { perMonthFromYearly?: boolean } = {}): string {
  const dollars = (options.perMonthFromYearly ? cents / 12 : cents) / 100;
  // Round to whole cents, then drop trailing zeros so 12.50 renders as 12.5.
  const rounded = Math.round(dollars * 100) / 100;

  // Plain dollar prefix, as in the published plan table and the desktop client.
  return `$${Number(rounded.toFixed(2))}`;
}

/** A price label split around its amount: `$16` and ` / member / month`. */
export interface PriceLabelParts {
  prefix: string;
  amount: string;
  suffix: string;
}

/**
 * Splits a desktop-style price template (`"{} / member / month"`) around its
 * `{}` placeholder so the amount can be rendered larger than the qualifier, as
 * the desktop compare dialog does. A template without a placeholder keeps the
 * amount in front of it.
 */
export function splitPriceTemplate(template: string, amount: string): PriceLabelParts {
  const index = template.indexOf('{}');

  if (index < 0) {
    return { prefix: '', amount, suffix: template ? ` ${template}` : '' };
  }

  return { prefix: template.slice(0, index), amount, suffix: template.slice(index + 2) };
}

export function getPlanPrice(plan: PricingPlan, interval: SubscriptionInterval): PricingPrice | undefined {
  return plan.prices.find((price) => price.interval === interval);
}

/** Per-month display price for the interval, or `null` when the plan has no such price. */
export function getPlanDisplayPrice(plan: PricingPlan, interval: SubscriptionInterval): string | null {
  const price = getPlanPrice(plan, interval);

  if (!price) return null;

  return formatPriceCents(price.price_cents, { perMonthFromYearly: interval === SubscriptionInterval.Year });
}

export function isFreePlan(plan: PricingPlan): boolean {
  return plan.prices.length === 0;
}

/** Plans that get a card in the compare view, in server order. */
export function workspacePlans(catalog: PricingCatalog): PricingPlan[] {
  return catalog.plans.filter((plan) => plan.kind === WORKSPACE_PLAN_KIND);
}

export function findPlan(catalog: PricingCatalog, id: string): PricingPlan | undefined {
  return catalog.plans.find((plan) => plan.id === id);
}

/** Maps a catalog plan id onto the checkout enum, or `undefined` for ids checkout does not know. */
export function toSubscriptionPlan(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLAN_IDS.has(id) ? (id as SubscriptionPlan) : undefined;
}

/** Localized noun for a feature key, or the server's `fallback` for keys this client does not know. */
export function localizeFeatureLabel(t: PricingTranslate, key: string, fallback: string): string {
  return t(`${FEATURE_LABEL_KEY_PREFIX}${key}`, { defaultValue: fallback });
}

/** Localized tooltip for a comparison row, the server's tooltip for keys this client does not know, or null. */
export function localizeFeatureTooltip(t: PricingTranslate, key: string, fallback: string | null): string | null {
  const text = t(`subscribe.featureTooltip.${key}`, { defaultValue: fallback ?? '' });

  return text ? text : null;
}

/** Localized value text; unknown kinds and units fall back to the server's `display`. */
export function localizeFeatureValue(t: PricingTranslate, value: FeatureValue): string {
  switch (value.kind) {
    case 'unlimited':
      return t('subscribe.value.unlimited', { defaultValue: value.display });
    case 'included':
      return t('subscribe.value.included', { defaultValue: value.display });
    case 'excluded':
      return t('subscribe.value.excluded', { defaultValue: value.display });
    case 'quantity': {
      const key = UNIT_VALUE_KEYS[value.unit];

      if (!key) return value.display;

      return t(key, { amount: value.amount, defaultValue: value.display });
    }

    case 'text':
      return value.display;
    default:
      return (value as { display?: string }).display ?? '';
  }
}

/**
 * Plan-card bullet for one feature:
 * - `excluded` features are skipped (`null`);
 * - keys this client cannot localize use the server's English sentence;
 * - `included` features show the localized noun;
 * - everything else composes "Noun: Value" from localized parts.
 */
export function formatFeatureBullet(t: PricingTranslate, feature: PricingFeature): string | null {
  if (feature.value.kind === 'excluded') return null;

  const noun = localizeFeatureLabel(t, feature.key, '');

  if (!noun) return feature.label;
  if (feature.value.kind === 'included') return noun;

  const value = localizeFeatureValue(t, feature.value);

  return t('subscribe.featureBullet', { feature: noun, value, defaultValue: `${noun}: ${value}` });
}
