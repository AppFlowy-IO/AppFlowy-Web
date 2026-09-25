import { FeatureValue, PricingCatalog, PricingPlan, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import {
  PricingTranslate,
  findPlan,
  formatFeatureBullet,
  formatPriceCents,
  getPlanDisplayPrice,
  getPlanPrice,
  isFreePlan,
  localizeFeatureLabel,
  localizeFeatureValue,
  splitPriceTemplate,
  toSubscriptionPlan,
  workspacePlans,
} from '@/utils/pricing';

const KNOWN: Record<string, string> = {
  'subscribe.feature.storage': 'Storage',
  'subscribe.feature.members': 'Members',
  'subscribe.feature.custom_namespace': 'Custom namespace',
  'subscribe.value.unlimited': 'Unlimited',
  'subscribe.value.included': 'Included',
  'subscribe.value.excluded': 'Not included',
  'subscribe.value.upTo': 'Up to {{amount}}',
  'subscribe.value.gb': '{{amount}} GB',
  'subscribe.value.mb': 'Up to {{amount}} MB',
  'subscribe.value.days': '{{amount}} days',
  'subscribe.value.hours': '{{amount}} hours',
  'subscribe.value.imagesPerMonth': '{{amount}} images per month',
  'subscribe.value.responsesLifetime': '{{amount}} lifetime',
  'subscribe.value.imagesLifetime': '{{amount}} lifetime',
  'subscribe.value.workspaces': '{{amount}} workspaces',
  'subscribe.value.forms': '{{amount}}',
  'subscribe.featureBullet': '{{feature}}: {{value}}',
};

// Mimics i18next: known keys interpolate `{{name}}`, unknown keys return `defaultValue`.
const t: PricingTranslate = (key, options = {}) => {
  const template = KNOWN[key];

  if (template === undefined) return (options.defaultValue as string | undefined) ?? key;

  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''));
};

const free: PricingPlan = {
  id: 'free',
  kind: 'workspace_plan',
  name: 'Free',
  description: 'Server free description',
  prices: [],
  features: [],
};

const pro: PricingPlan = {
  id: 'pro',
  kind: 'workspace_plan',
  name: 'Pro',
  description: 'Server pro description',
  prices: [
    { interval: SubscriptionInterval.Month, price_cents: 1250 },
    { interval: SubscriptionInterval.Year, price_cents: 12000 },
  ],
  features: [],
};

const aiMax: PricingPlan = {
  id: 'ai_max',
  kind: 'workspace_add_on',
  name: 'AI Max',
  description: 'Server AI Max description',
  prices: [{ interval: SubscriptionInterval.Year, price_cents: 9600 }],
  features: [],
};

const vault: PricingPlan = {
  id: 'vault_workspace',
  kind: 'account_add_on',
  name: 'Vault Workspace',
  description: 'Server vault description',
  prices: [{ interval: SubscriptionInterval.Month, price_cents: 750 }],
  features: [],
};

const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [free, pro, aiMax, vault],
  comparison: [],
};

describe('formatPriceCents', () => {
  it('renders short dollar strings without trailing zeros', () => {
    expect(formatPriceCents(1250)).toBe('$12.5');
    expect(formatPriceCents(1000)).toBe('$10');
    expect(formatPriceCents(0)).toBe('$0');
    expect(formatPriceCents(1299)).toBe('$12.99');
  });

  it('converts a yearly total into its monthly equivalent', () => {
    expect(formatPriceCents(12000, { perMonthFromYearly: true })).toBe('$10');
    expect(formatPriceCents(9600, { perMonthFromYearly: true })).toBe('$8');
    expect(formatPriceCents(7200, { perMonthFromYearly: true })).toBe('$6');
  });
});

describe('plan lookup helpers', () => {
  it('finds prices per interval and derives display prices', () => {
    expect(getPlanPrice(pro, SubscriptionInterval.Month)?.price_cents).toBe(1250);
    expect(getPlanDisplayPrice(pro, SubscriptionInterval.Month)).toBe('$12.5');
    expect(getPlanDisplayPrice(pro, SubscriptionInterval.Year)).toBe('$10');
    expect(getPlanDisplayPrice(aiMax, SubscriptionInterval.Year)).toBe('$8');
  });

  it('returns null when a plan has no price for the interval', () => {
    expect(getPlanPrice(free, SubscriptionInterval.Month)).toBeUndefined();
    expect(getPlanDisplayPrice(free, SubscriptionInterval.Year)).toBeNull();
    expect(getPlanDisplayPrice(aiMax, SubscriptionInterval.Month)).toBeNull();
  });

  it('identifies the free plan by its empty price list', () => {
    expect(isFreePlan(free)).toBe(true);
    expect(isFreePlan(pro)).toBe(false);
  });

  it('keeps only workspace plans in server order', () => {
    expect(workspacePlans(catalog).map((plan) => plan.id)).toEqual(['free', 'pro']);
    expect(workspacePlans({ ...catalog, plans: [pro, aiMax, free] }).map((plan) => plan.id)).toEqual(['pro', 'free']);
  });

  it('finds plans by id', () => {
    expect(findPlan(catalog, 'ai_max')).toBe(aiMax);
    expect(findPlan(catalog, 'team')).toBeUndefined();
  });

  it('maps catalog ids onto the checkout enum only when checkout knows them', () => {
    expect(toSubscriptionPlan('pro')).toBe(SubscriptionPlan.Pro);
    expect(toSubscriptionPlan('ai_max')).toBe(SubscriptionPlan.AIMax);
    expect(toSubscriptionPlan('vault_workspace')).toBeUndefined();
    expect(toSubscriptionPlan('')).toBeUndefined();
  });
});

describe('localization helpers', () => {
  it('localizes feature labels with the server label as fallback', () => {
    expect(localizeFeatureLabel(t, 'storage', 'Storage (server)')).toBe('Storage');
    expect(localizeFeatureLabel(t, 'quantum_sync', 'Quantum sync')).toBe('Quantum sync');
  });

  it.each<[FeatureValue, string]>([
    [{ kind: 'unlimited', display: 'Unlimited (server)' }, 'Unlimited'],
    [{ kind: 'included', display: 'yes' }, 'Included'],
    [{ kind: 'excluded', display: 'no' }, 'Not included'],
    [{ kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10 (server)' }, 'Up to 10'],
    [{ kind: 'quantity', amount: 10, unit: 'guests', display: 'x' }, 'Up to 10'],
    [{ kind: 'quantity', amount: 5, unit: 'gb', display: 'x' }, '5 GB'],
    [{ kind: 'quantity', amount: 7, unit: 'mb', display: 'x' }, 'Up to 7 MB'],
    [{ kind: 'quantity', amount: 30, unit: 'days', display: 'x' }, '30 days'],
    [{ kind: 'quantity', amount: 20, unit: 'hours', display: 'x' }, '20 hours'],
    [{ kind: 'quantity', amount: 10, unit: 'images_per_month', display: 'x' }, '10 images per month'],
    [{ kind: 'quantity', amount: 10, unit: 'responses_lifetime', display: 'x' }, '10 lifetime'],
    [{ kind: 'quantity', amount: 2, unit: 'images_lifetime', display: 'x' }, '2 lifetime'],
    [{ kind: 'quantity', amount: 1, unit: 'workspaces', display: 'x' }, '1 workspaces'],
    [{ kind: 'quantity', amount: 1, unit: 'forms', display: 'x' }, '1'],
    [{ kind: 'text', display: 'Limited trial' }, 'Limited trial'],
  ])('localizes %j as %s', (value, expected) => {
    expect(localizeFeatureValue(t, value)).toBe(expected);
  });

  it('falls back to the server display for unknown units and kinds', () => {
    expect(localizeFeatureValue(t, { kind: 'quantity', amount: 3, unit: 'parsecs', display: '3 parsecs' })).toBe(
      '3 parsecs'
    );
    expect(localizeFeatureValue(t, { kind: 'tier', display: 'Gold' } as unknown as FeatureValue)).toBe('Gold');
  });
});

describe('formatFeatureBullet', () => {
  it('skips excluded features', () => {
    expect(
      formatFeatureBullet(t, { key: 'guests', label: 'No guests', value: { kind: 'excluded', display: 'no' } })
    ).toBeNull();
  });

  it('shows the localized noun for included features', () => {
    expect(
      formatFeatureBullet(t, {
        key: 'custom_namespace',
        label: 'Custom namespace for your published site',
        value: { kind: 'included', display: 'yes' },
      })
    ).toBe('Custom namespace');
  });

  it('composes "Noun: Value" from localized parts', () => {
    expect(
      formatFeatureBullet(t, {
        key: 'members',
        label: 'Up to 10 workspace members',
        value: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' },
      })
    ).toBe('Members: Up to 10');
    expect(
      formatFeatureBullet(t, {
        key: 'storage',
        label: 'Unlimited storage',
        value: { kind: 'unlimited', display: 'Unlimited' },
      })
    ).toBe('Storage: Unlimited');
  });

  it('uses the server sentence for keys this client cannot localize', () => {
    expect(
      formatFeatureBullet(t, {
        key: 'quantum_sync',
        label: 'Quantum sync across galaxies',
        value: { kind: 'unlimited', display: 'Unlimited' },
      })
    ).toBe('Quantum sync across galaxies');
  });
});

describe('splitPriceTemplate', () => {
  it('splits the localized template around the amount', () => {
    expect(splitPriceTemplate('{} / member / month', '$16')).toEqual({
      prefix: '',
      amount: '$16',
      suffix: ' / member / month',
    });
  });

  it('keeps text before the placeholder', () => {
    expect(splitPriceTemplate('per member {} monthly', '$16')).toEqual({
      prefix: 'per member ',
      amount: '$16',
      suffix: ' monthly',
    });
  });

  it('keeps the amount when a template has no placeholder', () => {
    expect(splitPriceTemplate('per member / month', '$16')).toEqual({
      prefix: '',
      amount: '$16',
      suffix: ' per member / month',
    });
    expect(splitPriceTemplate('', '$0')).toEqual({ prefix: '', amount: '$0', suffix: '' });
  });
});
