export const integrationProviders = ['google-drive', 'google-calendar', 'github'] as const;

/** These providers connect immediately; GitHub authentication is requested by repository access. */
export const directConnectionProviders = ['google-drive', 'google-calendar'] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export interface IntegrationConnection {
  id: string;
  provider: string;
  connected_at: string;
  status: string;
  account_identifier?: string;
  metadata?: { github_login?: string; account_name?: string; avatar_url?: string; account_email?: string };
}

export function isIntegrationProvider(provider: string): provider is IntegrationProvider {
  return integrationProviders.some((value) => value === provider);
}
