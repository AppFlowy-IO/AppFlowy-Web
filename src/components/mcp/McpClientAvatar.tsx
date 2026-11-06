import { useState } from 'react';

import { getMcpClientDisplayName, safeHttpUrl } from '@/application/mcp/setup';
import type { McpClientSummary } from '@/application/services/domains/mcp';
import { cn } from '@/lib/utils';

export type McpClientAvatarSize = 'sm' | 'md' | 'lg';

export interface McpClientAvatarProps {
  client?: Pick<McpClientSummary, 'client_name' | 'client_host' | 'app_name' | 'verified_app' | 'logo_uri'> | null;
  /** 24, 32 (default) or 64 px. */
  size?: McpClientAvatarSize;
  className?: string;
}

const SIZE_CLASSES: Record<McpClientAvatarSize, string> = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-16 w-16 text-2xl',
};

/** Workspace avatar radius: 6 px at S and M; at XL 16 px for initials and 12 px for a logo. */
const RADIUS_CLASSES: Record<McpClientAvatarSize, { initials: string; image: string }> = {
  sm: { initials: 'rounded-200', image: 'rounded-200' },
  md: { initials: 'rounded-200', image: 'rounded-200' },
  lg: { initials: 'rounded-500', image: 'rounded-400' },
};

/**
 * An AI app's logo, or the first letter of its name or host. Decorative: the
 * name is always rendered next to it. Logos are third-party URLs, so only
 * http(s) is loaded and no referrer (which carries OAuth parameters on the
 * consent page) is sent.
 */
export function McpClientAvatar({ client, size = 'md', className }: McpClientAvatarProps) {
  const logo = safeHttpUrl(client?.logo_uri);
  const [failedLogo, setFailedLogo] = useState<string>();
  const initial = Array.from(getMcpClientDisplayName(client) ?? '?')[0].toUpperCase();
  const showLogo = Boolean(logo && logo !== failedLogo);
  // Variant classes come before `className` so a caller can still override them.
  const classes = cn(
    'flex shrink-0 items-center justify-center overflow-hidden',
    SIZE_CLASSES[size],
    showLogo
      ? cn(RADIUS_CLASSES[size].image, 'border border-border-primary bg-fill-content')
      : cn(RADIUS_CLASSES[size].initials, 'bg-badge-color-20-light-2 font-normal text-badge-color-20-thick-3'),
    className
  );

  if (showLogo) {
    return (
      <span className={classes} aria-hidden='true' data-testid='mcp-client-avatar'>
        <img
          src={logo}
          alt=''
          referrerPolicy='no-referrer'
          loading='lazy'
          decoding='async'
          className='h-full w-full object-contain'
          onError={() => setFailedLogo(logo)}
        />
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden='true' data-testid='mcp-client-avatar'>
      {initial}
    </span>
  );
}

export default McpClientAvatar;
