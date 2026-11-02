import { useState } from 'react';

import { getMcpClientDisplayName, safeHttpUrl } from '@/application/mcp/setup';
import type { McpClientSummary } from '@/application/services/domains/mcp';
import { cn } from '@/lib/utils';

export type McpClientAvatarSize = 'sm' | 'md' | 'lg';

export interface McpClientAvatarProps {
  client?: Pick<McpClientSummary, 'client_name' | 'client_host' | 'app_name' | 'verified_app' | 'logo_uri'> | null;
  /** 24, 32 (default) or 48 px. */
  size?: McpClientAvatarSize;
  className?: string;
}

const SIZE_CLASSES: Record<McpClientAvatarSize, string> = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-12 w-12 text-xl',
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
  const classes = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-300 border border-border-primary',
    SIZE_CLASSES[size],
    className
  );

  if (logo && logo !== failedLogo) {
    return (
      <span className={cn(classes, 'bg-surface-primary')} aria-hidden='true' data-testid='mcp-client-avatar'>
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
    <span
      className={cn(classes, 'bg-fill-content-hover font-medium text-text-secondary')}
      aria-hidden='true'
      data-testid='mcp-client-avatar'
    >
      {initial}
    </span>
  );
}

export default McpClientAvatar;
