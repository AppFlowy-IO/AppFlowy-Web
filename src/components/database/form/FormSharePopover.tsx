import { Check, ChevronRight, FileText, Link as LinkIcon, Lock, Sparkles, User, UserCheck } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';

import {
  FormShareInfo,
  FormShareTier,
  FormSubmissionAccess,
} from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { FormShareErrorKind } from './useFormShare';

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
  errorKind,
  onUpgradePlan,
  setTier,
  setAnonymous,
  setSubmissionAccess,
  url,
}: {
  trigger: React.ReactNode;
  info: FormShareInfo | null;
  /// Bootstrap pending — shows the skeleton. Distinct from `info === null
  /// && !isLoading` (which is an error state).
  isLoading: boolean;
  /// Set when the cloud refused the bootstrap (regression image #41).
  /// `'plan_required'` swaps the popover body for an upgrade prompt
  /// instead of an infinite skeleton; `'other'` shows a generic error
  /// so the user knows it isn't loading anymore.
  errorKind: FormShareErrorKind | null;
  onUpgradePlan: () => void;
  setTier: (t: FormShareTier) => Promise<void>;
  setAnonymous: (v: boolean) => Promise<void>;
  setSubmissionAccess: (a: FormSubmissionAccess) => Promise<void>;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read workspace name for the "Anyone at {name} with link" copy
  // (Notion parity, image #12 / #13). `AuthInternalContext` is null on
  // publish/embed surfaces — fall back to a generic label there rather
  // than throwing.
  const auth = useContext(AuthInternalContext);
  const workspaceName =
    auth?.userWorkspaceInfo?.selectedWorkspace?.name ?? 'this workspace';

  const tier = info?.tier ?? 'workspace';
  const anonymous = info?.anonymous ?? true;
  const submissionAccess = info?.submission_access ?? 'none';
  const showSubmissionAccess = tier === 'workspace' && !anonymous;

  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
    };
  }, []);

  const copy = async () => {
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
          // Bootstrap not complete (or failed). Three branches:
          //   * Still loading → skeleton (existing behaviour).
          //   * plan_required → upgrade prompt (regression image #41:
          //     DEV mode lets the popover open on Free workspaces, but
          //     the cloud's `is_workspace_on_paid_plan` gate refuses
          //     the mint — without this branch the skeleton would
          //     animate forever).
          //   * other error → generic non-skeleton message so the user
          //     can close + retry instead of staring at a "loading"
          //     indicator that won't resolve.
          isLoading ? (
            <ShareLoading />
          ) : errorKind === 'plan_required' ? (
            <UpgradePrompt onUpgradePlan={onUpgradePlan} />
          ) : (
            <GenericLoadFailure />
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
                  onSelect={setTier}
                />
              }
            />
            <ToggleRow
              icon={<UserCheck size={14} />}
              label='Anonymous responses'
              checked={anonymous}
              forcedOn={tier === 'public'}
              forcedTooltip='Public forms always collect responses anonymously.'
              onChange={setAnonymous}
            />
            {showSubmissionAccess && (
              <SubMenuRow
                icon={<FileText size={14} />}
                label='Access to submission'
                value={submissionAccessLabel(submissionAccess)}
                submenu={
                  <AccessSubmenu current={submissionAccess} onSelect={setSubmissionAccess} />
                }
              />
            )}
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
            <div className='mx-1 flex items-stretch overflow-hidden rounded-md border border-line-divider'>
              <input
                readOnly
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
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ShareLoading() {
  return (
    <div
      data-testid='form-share-popover-loading'
      className='flex flex-col gap-2 px-2 py-3'
    >
      <div className='h-8 w-full animate-pulse rounded bg-fill-content' />
      <div className='h-8 w-full animate-pulse rounded bg-fill-content' />
      <div className='mt-2 h-7 w-full animate-pulse rounded bg-fill-content' />
    </div>
  );
}

/**
 * Shown when the cloud refused to mint the share token because the
 * workspace isn't on a paid plan. Replaces the previous always-skeleton
 * behaviour where DEV-mode Free workspaces saw a frozen popover.
 *
 * The CTA hands off to `?action=change_plan`, the same upgrade entry
 * the chart-layout settings + AddViewButton's Form item use.
 */
function UpgradePrompt({ onUpgradePlan }: { onUpgradePlan: () => void }) {
  return (
    <div
      data-testid='form-share-popover-upgrade-prompt'
      className='flex flex-col items-center gap-3 px-4 py-5 text-center'
    >
      <Sparkles size={20} className='text-fill-default' />
      <div className='text-sm font-semibold'>Sharing forms is a Pro feature</div>
      <p className='text-xs text-text-caption'>
        Upgrade to Pro or Team to publish forms and collect responses.
      </p>
      <Button
        data-testid='form-share-popover-upgrade-cta'
        size='sm'
        onClick={onUpgradePlan}
      >
        See upgrade options
      </Button>
    </div>
  );
}

/**
 * Catch-all for non-plan-gate failures (network, permission, transient
 * cloud errors). Distinct from the loading skeleton so the user
 * understands the popover finished trying and isn't going to resolve
 * on its own.
 */
function GenericLoadFailure() {
  return (
    <div
      data-testid='form-share-popover-error'
      className='flex flex-col items-center gap-2 px-4 py-5 text-center'
    >
      <div className='text-sm font-medium'>Couldn&apos;t load share settings</div>
      <p className='text-xs text-text-caption'>
        Close this popover and try again. If the problem persists, refresh
        the page.
      </p>
    </div>
  );
}

function SubMenuRow({
  icon,
  label,
  value,
  badge,
  submenu,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
  submenu: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
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
          <span className='flex-1 truncate whitespace-nowrap text-left'>
            {label}
          </span>
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
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  forcedOn: boolean;
  forcedTooltip: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      title={forcedOn ? forcedTooltip : undefined}
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1 text-sm',
        forcedOn && 'opacity-70',
      )}
    >
      <span className='text-text-tertiary'>{icon}</span>
      <span className='flex-1 whitespace-nowrap'>{label}</span>
      <Switch
        checked={checked}
        disabled={forcedOn}
        onCheckedChange={(v) => onChange(!!v)}
      />
    </div>
  );
}

function TierSubmenu({
  current,
  workspaceName,
  onSelect,
}: {
  current: FormShareTier;
  workspaceName: string;
  onSelect: (t: FormShareTier) => void;
}) {
  return (
    <div className='flex flex-col'>
      <Choice
        selected={current === 'workspace'}
        title={`Anyone at ${workspaceName} with link`}
        subtitle='Only signed-in members can fill out.'
        onClick={() => onSelect('workspace')}
        leadingIcon={<Lock size={14} />}
      />
      <Choice
        selected={current === 'public'}
        title='Anyone on the web with link'
        titleBadge={<TierBadge kind='public' />}
        subtitle='Anyone with the URL can fill out. Forces anonymous responses.'
        onClick={() => onSelect('public')}
      />
      <Choice
        selected={current === 'closed'}
        title='No access'
        titleBadge={<TierBadge kind='closed' />}
        subtitle='Closes the form. Existing link returns "no longer accepting".'
        onClick={() => onSelect('closed')}
      />
    </div>
  );
}

function AccessSubmenu({
  current,
  onSelect,
}: {
  current: FormSubmissionAccess;
  onSelect: (a: FormSubmissionAccess) => void;
}) {
  return (
    <div className='flex flex-col'>
      <Choice
        selected={current === 'none'}
        title='No access'
        subtitle="Respondents can't revisit their submission."
        onClick={() => onSelect('none')}
      />
      <Choice
        selected={current === 'view'}
        title='Can view'
        subtitle='Respondents can see what they submitted.'
        onClick={() => onSelect('view')}
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
}: {
  selected: boolean;
  title: string;
  titleBadge?: React.ReactNode;
  subtitle: string;
  onClick: () => void;
  leadingIcon?: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content'
    >
      <span className='mt-0.5 text-text-tertiary'>
        {selected ? <Check size={14} className='text-fill-default' /> : (leadingIcon ?? <span className='inline-block h-3.5 w-3.5' />)}
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
    kind === 'public'
      ? 'bg-fill-warning-light text-text-warning-on-fill'
      : 'bg-fill-secondary text-text-caption';
  const label = kind === 'public' ? 'Public' : 'Closed';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
        palette,
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

function submissionAccessLabel(a: FormSubmissionAccess): string {
  switch (a) {
    case 'none':
      return 'No access';
    case 'view':
      return 'Can view';
  }
}
