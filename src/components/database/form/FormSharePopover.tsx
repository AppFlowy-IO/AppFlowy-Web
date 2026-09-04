import { Check, ChevronRight, Link as LinkIcon, Lock, User, UserCheck } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';

import { FormShareInfo, FormShareTier } from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Notion-parity share popover (Image #10) — three rows + the link row.
 * Used by both the toolbar's `Share form` button and the access
 * banner's `Change` button.
 *
 * Rows hide/disable themselves per the same invariant the cloud
 * enforces (`coerce_submission_access`): Public tier forces anonymous
 * ON and submission-access OFF; anonymous=true hides the
 * submission-access row.
 */
export function FormSharePopover({
  trigger,
  info,
  isLoading,
  errorMessage,
  onRetry,
  onRetryMutation,
  canUpdateSettings,
  setTier,
  setAnonymous,
  url,
}: {
  trigger: React.ReactNode;
  info: FormShareInfo | null;
  /// Bootstrap pending — shows the skeleton. Distinct from `info === null
  /// && !isLoading` (which is an error state).
  isLoading: boolean;
  /// Raw error message from the failed bootstrap. Surfaced in the
  /// generic-failure UI so a user-reported screenshot carries the
  /// underlying cause (cloud error code / network failure / etc.) —
  /// the popover alone is otherwise the only diagnostic surface.
  errorMessage: string | null;
  onRetry: () => void;
  /** Replays the retained final settings choice after a PATCH failure. */
  onRetryMutation: () => void;
  /** Page permission. False keeps inspection/copy available but blocks writes. */
  canUpdateSettings: boolean;
  setTier: (t: FormShareTier) => Promise<void>;
  setAnonymous: (v: boolean) => Promise<void>;
  // `setSubmissionAccess` removed from the surface while the
  // submission-access row is unmounted. The data wiring on the
  // controller stays so the prop can be re-added without a
  // controller-layer change.
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read workspace name for the "Anyone at {name} with link" copy
  // (Notion parity, image #12 / #13). `AuthInternalContext` is null on
  // publish/embed surfaces — fall back to a generic label there rather
  // than throwing.
  const auth = useContext(AuthInternalContext);
  const workspaceName = auth?.userWorkspaceInfo?.selectedWorkspace?.name ?? 'this workspace';

  const tier = info?.tier ?? 'workspace';
  const anonymous = info?.anonymous ?? true;

  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
    };
  }, []);

  const copy = async () => {
    if (!url) return;

    await navigator.clipboard.writeText(url);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align='end' className='w-[420px] p-1 pb-3'>
        {info === null ? (
          // Bootstrap not complete (or failed). Keep loading, read-only empty,
          // and terminal failure states distinct so each has an actionable UI.
          isLoading ? (
            <ShareLoading />
          ) : !errorMessage && !canUpdateSettings ? (
            <NoActiveShare onRetry={onRetry} />
          ) : (
            <GenericLoadFailure errorMessage={errorMessage} onRetry={onRetry} />
          )
        ) : (
          <>
            <SubMenuRow
              icon={<User size={14} />}
              label='Who can fill out'
              value={tierLabel(tier, workspaceName)}
              badge={tierBadge(tier)}
              submenu={
                <TierSubmenu
                  current={tier}
                  workspaceName={workspaceName}
                  canUpdateSettings={canUpdateSettings}
                  onSelect={setTier}
                />
              }
            />
            <ToggleRow
              testId='form-share-anonymous-toggle'
              icon={<UserCheck size={14} />}
              label='Anonymous responses'
              checked={anonymous}
              forcedOn={tier === 'public'}
              forcedTooltip='Public forms always collect responses anonymously.'
              disabled={!canUpdateSettings}
              disabledTooltip='View-only access can inspect and copy this link, but cannot change settings.'
              onChange={setAnonymous}
            />
            {canUpdateSettings && errorMessage && (
              <MutationFailure errorMessage={errorMessage} onRetry={onRetryMutation} />
            )}
            {/*
              Submission-access row intentionally omitted. The cloud's
              `supported_submission_access` (`share.rs:86`) hardcodes
              the value to `None` regardless of request — shipping the
              UI affordance was misleading because the "Can view" choice
              never persisted. Re-introduce this block once the cloud
              implements `view` for real. The data wiring (`info.submission_access`,
              `setSubmissionAccess`) stays intact so the row can be
              restored without touching the controller layer.
            */}
            <div className='my-2 border-t border-line-divider' />
            {/*
              Notion-parity link row (matches desktop's `_LinkRow`):
              ONE rounded container with a vertical hairline divider
              between the URL field and the copy button. The previous
              `gap-2` + individual borders produced two visually separate
              pills with a gap — broke the unified-box look.
              `overflow-hidden` clips the button's hover splash to the
              rounded corners.
            */}
            {url ? (
              <div className='mx-1 flex items-stretch overflow-hidden rounded-md border border-line-divider'>
                <input
                  readOnly
                  aria-label='Form share URL'
                  value={url}
                  className='flex-1 bg-transparent px-2 py-1 text-xs outline-none'
                />
                <div className='w-px bg-line-divider' />
                <button
                  type='button'
                  onClick={copy}
                  className='flex shrink-0 items-center gap-1 px-3 py-1 text-xs hover:bg-fill-content'
                >
                  <LinkIcon size={12} />
                  {copied ? 'Copied' : 'Copy form link'}
                </button>
              </div>
            ) : (
              <ShareLinkUnavailable onRetry={onRetry} />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ShareLinkUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid='form-share-link-unavailable'
      role='alert'
      className='mx-1 flex items-center gap-2 rounded-md border border-line-divider px-2 py-2'
    >
      <p className='min-w-0 flex-1 text-xs text-text-tertiary'>Form link unavailable.</p>
      <Button data-testid='form-share-link-unavailable-retry' size='sm' variant='ghost' onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function NoActiveShare({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid='form-share-popover-no-active-link'
      className='flex flex-col items-center gap-2 px-4 py-5 text-center'
    >
      <div className='text-sm font-medium'>No active form link</div>
      <p className='text-xs text-text-caption'>Ask someone with edit access to create and configure the share link.</p>
      <Button data-testid='form-share-popover-no-active-retry' size='sm' variant='ghost' onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function MutationFailure({ errorMessage, onRetry }: { errorMessage: string; onRetry: () => void }) {
  return (
    <div
      data-testid='form-share-mutation-error'
      role='alert'
      className='mx-1 mt-2 flex items-center gap-2 rounded-md border border-line-divider px-2 py-2'
    >
      <div className='min-w-0 flex-1'>
        <p className='text-xs font-medium'>Couldn&apos;t save share settings</p>
        <p className='truncate text-[11px] text-text-tertiary' title={errorMessage}>
          {errorMessage}
        </p>
      </div>
      <Button data-testid='form-share-mutation-retry' size='sm' variant='ghost' onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function ShareLoading() {
  return (
    <div data-testid='form-share-popover-loading' className='flex flex-col items-center gap-3 px-4 py-6'>
      {/*
        Visible "Loading…" copy + skeleton bars. The previous skeleton-
        only design (image #44) used `bg-fill-content` which matches the
        popover's `bg-surface-layer-03` surface in dark mode — the bars
        rendered as invisible boxes. Adding text gives the user
        something to read while the bootstrap retries against the
        cloud's folder cache, and `bg-fill-secondary` is the
        established "filled placeholder" token that contrasts with both
        the surface above and the text below.
      */}
      <p className='text-sm text-text-caption'>Loading share settings…</p>
      <div className='flex w-full flex-col gap-2'>
        <div className='h-8 w-full animate-pulse rounded bg-fill-secondary' />
        <div className='h-8 w-full animate-pulse rounded bg-fill-secondary' />
        <div className='mt-1 h-7 w-full animate-pulse rounded bg-fill-secondary' />
      </div>
    </div>
  );
}

/**
 * Catch-all for failures (network, permission, transient cloud errors).
 * Distinct from the loading skeleton so the user
 * understands the popover finished trying and isn't going to resolve
 * on its own.
 *
 * Surfaces the underlying error message so a user-reported screenshot
 * carries the diagnostic context — without this the only signal is
 * the generic copy, and tracking down whether it's a network glitch /
 * permission / cloud-side validation requires reproducing locally
 * with devtools open.
 */
function GenericLoadFailure({ errorMessage, onRetry }: { errorMessage: string | null; onRetry: () => void }) {
  return (
    <div data-testid='form-share-popover-error' className='flex flex-col items-center gap-2 px-4 py-5 text-center'>
      <div className='text-sm font-medium'>Couldn&apos;t load share settings</div>
      <p className='text-xs text-text-caption'>Try again. If the problem persists, refresh the page.</p>
      <Button data-testid='form-share-popover-retry' size='sm' onClick={onRetry}>
        Retry
      </Button>
      {errorMessage && (
        <p
          data-testid='form-share-popover-error-detail'
          className='mt-2 max-w-full break-words text-[11px] text-text-tertiary'
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function SubMenuRow({
  icon,
  label,
  value,
  badge,
  submenu,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
  submenu: React.ReactNode;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid={testId}
          type='button'
          className='flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-fill-content'
        >
          <span className='text-text-tertiary'>{icon}</span>
          {/*
            `whitespace-nowrap` keeps "Who can fill out" / "Access to
            submission" on a single line even when the value+badge eats
            a lot of horizontal space; without it the flex-1 span lets
            the browser wrap the label to two lines (user-reported
            regression — see the wider-popover screenshot).
          */}
          <span className='flex-1 truncate whitespace-nowrap text-left'>{label}</span>
          <span className='flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary'>
            <span className='truncate'>{value}</span>
            {badge}
          </span>
          <ChevronRight size={14} className='shrink-0 text-text-tertiary' />
        </button>
      </PopoverTrigger>
      <PopoverContent side='right' align='start' className='w-72 p-1'>
        {submenu}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Single-line `icon · label · toggle` row. The forced-on hint
 * (`forcedTooltip`) is attached to the row's native `title` attribute so
 * the user can hover to learn why the toggle is locked, without the
 * subtitle taking up vertical space in the normal layout — the previous
 * two-line variant made the popover ~2× taller than the Notion reference
 * for no gain when the row isn't disabled.
 */
function ToggleRow({
  icon,
  label,
  checked,
  forcedOn,
  forcedTooltip,
  disabled = false,
  disabledTooltip,
  onChange,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  forcedOn: boolean;
  forcedTooltip: string;
  disabled?: boolean;
  disabledTooltip?: string;
  onChange: (value: boolean) => void;
  testId?: string;
}) {
  return (
    <div
      title={forcedOn ? forcedTooltip : disabled ? disabledTooltip : undefined}
      className={cn('flex items-center gap-2 rounded px-2 py-1 text-sm', (forcedOn || disabled) && 'opacity-70')}
    >
      <span className='text-text-tertiary'>{icon}</span>
      <span className='flex-1 whitespace-nowrap'>{label}</span>
      <Switch
        data-testid={testId}
        aria-label={label}
        checked={checked}
        disabled={forcedOn || disabled}
        onCheckedChange={(v) => onChange(!!v)}
      />
    </div>
  );
}

function TierSubmenu({
  current,
  workspaceName,
  canUpdateSettings,
  onSelect,
}: {
  current: FormShareTier;
  workspaceName: string;
  canUpdateSettings: boolean;
  onSelect: (t: FormShareTier) => void;
}) {
  const selectTier = (next: FormShareTier) => {
    if (next === current) return;
    if (!canUpdateSettings) return;
    onSelect(next);
  };

  return (
    <div className='flex flex-col'>
      <Choice
        testId='form-share-tier-choice-workspace'
        selected={current === 'workspace'}
        title={`Anyone at ${workspaceName} with link`}
        subtitle='Only signed-in members can fill out.'
        onClick={() => selectTier('workspace')}
        leadingIcon={<Lock size={14} />}
        disabled={!canUpdateSettings}
      />
      <Choice
        testId='form-share-tier-choice-public'
        selected={current === 'public'}
        title='Anyone on the web with link'
        titleBadge={<TierBadge kind='public' />}
        subtitle='Anyone with the URL can fill out. Forces anonymous responses.'
        onClick={() => selectTier('public')}
        disabled={!canUpdateSettings}
      />
      <Choice
        testId='form-share-tier-choice-closed'
        selected={current === 'closed'}
        title='No access'
        titleBadge={<TierBadge kind='closed' />}
        subtitle='Closes the form. Existing link returns "no longer accepting".'
        onClick={() => selectTier('closed')}
        disabled={!canUpdateSettings}
      />
    </div>
  );
}

function Choice({
  selected,
  title,
  titleBadge,
  subtitle,
  onClick,
  leadingIcon,
  testId,
  disabled = false,
}: {
  selected: boolean;
  title: string;
  titleBadge?: React.ReactNode;
  subtitle: string;
  onClick: () => void;
  leadingIcon?: React.ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      type='button'
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className='flex items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content disabled:cursor-not-allowed disabled:opacity-60'
    >
      <span className='mt-0.5 text-text-tertiary'>
        {selected ? (
          <Check size={14} className='text-fill-default' />
        ) : (
          leadingIcon ?? <span className='inline-block h-3.5 w-3.5' />
        )}
      </span>
      <span className='flex-1'>
        <div className='flex items-center gap-1.5 font-medium'>
          {title}
          {titleBadge}
        </div>
        <div className='text-xs text-text-caption'>{subtitle}</div>
      </span>
    </button>
  );
}

/**
 * Notion-style pill badge surfacing the tier kind alongside long labels
 * (image #12 / #13). Visually distinct from a plain text label so the
 * difference between "Anyone at Workspace" (no badge — workspace-internal,
 * the default) and "Anyone on the web [Public]" (eye-catching warning
 * color) is obvious at a glance.
 */
function TierBadge({ kind }: { kind: 'public' | 'closed' }) {
  // Established AppFlowy badge palette — `bg-fill-warning-light` plus
  // `text-text-warning-on-fill` matches the guest-pill in `PersonItem`,
  // `WorkspaceItem`, `PersonSuggestionItem`. The earlier
  // `bg-fill-warning/15 text-fill-warning` tokens don't exist in
  // `tailwind/new-colors.cjs` and rendered as transparent.
  const palette =
    kind === 'public' ? 'bg-fill-warning-light text-text-warning-on-fill' : 'bg-fill-secondary text-text-caption';
  const label = kind === 'public' ? 'Public' : 'Closed';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
        palette
      )}
    >
      {label}
    </span>
  );
}

function tierLabel(t: FormShareTier, workspaceName: string): string {
  switch (t) {
    case 'workspace':
      return `Anyone at ${workspaceName} with link`;
    case 'public':
      return 'Anyone on the web with link';
    case 'closed':
      return 'No access';
  }
}

function tierBadge(t: FormShareTier): React.ReactNode {
  switch (t) {
    case 'public':
      return <TierBadge kind='public' />;
    case 'closed':
      return <TierBadge kind='closed' />;
    case 'workspace':
    default:
      return null;
  }
}
