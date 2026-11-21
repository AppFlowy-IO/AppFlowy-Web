export const integrationProviders = ['google-drive', 'google-calendar'] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export interface IntegrationConnection {
  id: string;
  provider: string;
  connected_at: string;
  status: string;
  account_identifier?: string;
}

export function isAutomationProvider(provider: string): provider is 'slack' | 'gmail' {
  return provider === 'slack' || provider === 'gmail';
}

export function isIntegrationProvider(provider: string): provider is IntegrationProvider {
  return integrationProviders.some((value) => value === provider);
}
