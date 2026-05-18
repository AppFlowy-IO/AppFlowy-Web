import { Check, ChevronRight, FileText, Link as LinkIcon, Lock, User, UserCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  FormShareInfo,
  FormShareTier,
  FormSubmissionAccess,
} from '@/application/services/js-services/http';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  setTier,
  setAnonymous,
  setSubmissionAccess,
  url,
}: {
  trigger: React.ReactNode;
  info: FormShareInfo | null;
  setTier: (t: FormShareTier) => Promise<void>;
  setAnonymous: (v: boolean) => Promise<void>;
  setSubmissionAccess: (a: FormSubmissionAccess) => Promise<void>;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <PopoverContent align='end' className='w-96 p-2'>
        <SubMenuRow
          icon={<User size={14} />}
          label='Who can fill out'
          value={tierLabel(tier)}
          submenu={
            <TierSubmenu current={tier} onSelect={setTier} />
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
        <div className='flex items-center gap-2 px-1'>
          <input
            readOnly
            value={url}
            className='flex-1 rounded-l-md border border-r-0 border-line-divider px-2 py-1 text-xs'
          />
          <button
            type='button'
            onClick={copy}
            className='flex items-center gap-1 rounded-r-md border border-line-divider px-2 py-1 text-xs hover:bg-fill-content'
          >
            <LinkIcon size={12} />
            {copied ? 'Copied' : 'Copy form link'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SubMenuRow({
  icon,
  label,
  value,
  submenu,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  submenu: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-fill-content'
        >
          <span className='text-text-tertiary'>{icon}</span>
          <span className='flex-1 text-left'>{label}</span>
          <span className='text-xs text-text-tertiary'>{value}</span>
          <ChevronRight size={14} className='text-text-tertiary' />
        </button>
      </PopoverTrigger>
      <PopoverContent side='right' align='start' className='w-72 p-1'>
        {submenu}
      </PopoverContent>
    </Popover>
  );
}

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
        'flex items-center gap-2 rounded px-2 py-2 text-sm',
        forcedOn && 'opacity-70',
      )}
    >
      <span className='text-text-tertiary'>{icon}</span>
      <span className='flex-1'>{label}</span>
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
  onSelect,
}: {
  current: FormShareTier;
  onSelect: (t: FormShareTier) => void;
}) {
  return (
    <div className='flex flex-col'>
      <Choice
        selected={current === 'workspace'}
        title='Workspace members with link'
        subtitle='Only signed-in members can fill out.'
        onClick={() => onSelect('workspace')}
        leadingIcon={<Lock size={14} />}
      />
      <Choice
        selected={current === 'public'}
        title='Anyone with link'
        subtitle='Anyone with the URL can fill out. Forces anonymous responses.'
        onClick={() => onSelect('public')}
      />
      <Choice
        selected={current === 'closed'}
        title='No access'
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
  subtitle,
  onClick,
  leadingIcon,
}: {
  selected: boolean;
  title: string;
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
        <div className='font-medium'>{title}</div>
        <div className='text-xs text-text-caption'>{subtitle}</div>
      </span>
    </button>
  );
}

function tierLabel(t: FormShareTier): string {
  switch (t) {
    case 'workspace':
      return 'Workspace members with link';
    case 'public':
      return 'Anyone with link';
    case 'closed':
      return 'No access';
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
