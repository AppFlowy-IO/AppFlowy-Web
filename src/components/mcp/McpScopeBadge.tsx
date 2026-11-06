import { useTranslation } from 'react-i18next';

import { scopeLevel, type McpScopeLevel } from '@/application/mcp/setup';
import { cn } from '@/lib/utils';

export interface McpScopeBadgeProps {
  /** A granted scope string (`read write`); null or empty means read only. */
  scope?: string | null;
  className?: string;
}

const LEVELS: Record<McpScopeLevel, { label: 'scopeRead' | 'scopeWrite' | 'scopeFull'; className: string }> = {
  read: { label: 'scopeRead', className: 'bg-fill-content-visible text-text-secondary' },
  write: { label: 'scopeWrite', className: 'bg-fill-info-light text-text-info-on-fill' },
  full: { label: 'scopeFull', className: 'bg-fill-warning-light text-text-warning-on-fill' },
};

/** "Read only", "Read and write" or "Full access" for a granted scope. */
export function McpScopeBadge({ scope, className }: McpScopeBadgeProps) {
  const { t } = useTranslation();
  const level = scopeLevel(scope);
  const { label, className: levelClassName } = LEVELS[level];

  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-sm font-normal',
        levelClassName,
        className
      )}
      data-testid='mcp-scope-badge'
      data-level={level}
    >
      {t(`settings.mcp.${label}`)}
    </span>
  );
}

export default McpScopeBadge;
