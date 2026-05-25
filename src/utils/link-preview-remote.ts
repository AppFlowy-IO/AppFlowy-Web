import { LinkPreviewData, LinkPreviewProvider, registerLinkPreviewProvider } from '@/utils/link-preview';

const REMOTE_PREVIEW_ENDPOINT = '/api/link-preview';

// Run ahead of the microlink (100) and github (110) providers so the
// AppFlowy-hosted unfurler — which mirrors the desktop scraper — is the primary
// source, leaving those third-party services as graceful fallbacks.
const REMOTE_PREVIEW_PRIORITY = 60;

export const appflowyLinkPreviewProvider: LinkPreviewProvider = {
  id: 'appflowy-unfurl',
  priority: REMOTE_PREVIEW_PRIORITY,
  canHandle: (context) => {
    const protocol = context.parsedUrl?.protocol;

    return protocol === 'http:' || protocol === 'https:';
  },
  async fetch(context) {
    const endpoint = `${REMOTE_PREVIEW_ENDPOINT}?url=${encodeURIComponent(context.normalizedUrl)}`;
    const response = await fetch(endpoint, { signal: context.signal });

    if (!response.ok) return undefined;

    let data: Partial<LinkPreviewData> | null = null;

    try {
      data = (await response.json()) as Partial<LinkPreviewData>;
    } catch {
      return undefined;
    }

    if (!data || !data.title) return undefined;

    return {
      title: data.title,
      description: data.description ?? '',
      ...(data.image?.url ? { image: { url: data.image.url } } : {}),
      ...(data.logo?.url ? { logo: { url: data.logo.url } } : {}),
    };
  },
};

let registered = false;

/**
 * Registers the AppFlowy-hosted link preview provider. Called once at app
 * startup; kept out of the link-preview module itself so unit tests exercise
 * the default providers in isolation.
 */
export function registerAppflowyLinkPreviewProvider(): void {
  if (registered) return;
  registered = true;
  registerLinkPreviewProvider(appflowyLinkPreviewProvider);
}
