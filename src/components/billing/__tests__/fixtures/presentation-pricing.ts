import type { PricingCatalog, PricingComparisonRow } from '@/application/types';
import { SubscriptionInterval } from '@/application/types';

// Representative server-owned rows, deliberately absent from client translations.
// This fixture does not fetch a deployed catalog or start checkout.
export const presentationRows: PricingComparisonRow[] = [
  ['presentation_slides', 'AI presentation slides', '12 lifetime slides', '100 slides per presentation'],
  ['custom_slide_count', 'Custom slide counts', 'Auto and presets', 'Custom counts available'],
  ['pptx_export', 'PowerPoint exports', '1 lifetime export', 'Unlimited exports'],
  ['ai_mind_maps', 'AI mind maps', 'Uses shared AI responses', 'Uses shared AI responses'],
  ['mindmap_structure', 'Mind map structure', 'Right-facing', 'Four directions'],
  ['mindmap_branches', 'Mind map branches', 'Rounded branches', 'Rounded and curved branches'],
  ['company_style', 'Company styles', 'Ordinary templates', 'Owner-managed company styles'],
  ['template_uploads', 'PowerPoint template uploads', 'Up to 5 MiB', 'Up to 50 MiB'],
].map(([key, label, free, pro]) => ({
  key, label, tooltip: `Server benefit: ${label}`,
  values: { free: { kind: 'text', display: free }, pro: { kind: 'text', display: pro } },
}));

export const presentationPricing: PricingCatalog = {
  version: 1, currency: 'USD', annual_discount_percent: 20,
  plans: [
    { id: 'free', kind: 'workspace_plan', name: 'Free', description: 'Free workspace', prices: [], features: [] },
    { id: 'pro', kind: 'workspace_plan', name: 'Pro', description: 'Pro workspace',
      prices: [{ interval: SubscriptionInterval.Month, price_cents: 1250 }], features: [] },
  ],
  comparison: presentationRows,
};
