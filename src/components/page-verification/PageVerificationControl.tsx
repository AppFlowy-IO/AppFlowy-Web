import AllInclusive from '@mui/icons-material/AllInclusive';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import Verified from '@mui/icons-material/Verified';
import { MenuItem, MenuList } from '@mui/material';
import { addDays, endOfDay } from 'date-fns';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseVerification } from '@/application/page-verification/database';
import { verificationStore, useVerification } from '@/application/page-verification/store';
import { VerificationExpiration, verificationTooltip } from '@/application/page-verification/types';
import { usePublishContext } from '@/application/publish';
import { removePageVerification, verifyPage } from '@/application/services/js-services/http/page-verification-api';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ClockIcon } from '@/assets/icons/clock_alarm.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/date.svg';
import { ReactComponent as VerifyIcon } from '@/assets/icons/verify.svg';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import UpgradePlan from '@/components/billing/UpgradePlan';
import MentionDatePicker from '@/components/editor/components/leaf/mention/MentionDatePicker';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import HeaderToolbarButton from '@/components/view-meta/HeaderToolbarButton';
import { cn } from '@/lib/utils';

const expirationOptions = [
  { kind: 'ninety_days', label: 'For 90 days', days: 90 },
  { kind: 'thirty_days', label: 'For 30 days', days: 30 },
  { kind: 'seven_days', label: 'For 7 days', days: 7 },
  { kind: 'indefinitely', label: 'Indefinitely', days: null },
  { kind: 'custom', label: 'Pick a date', days: null },
] as const;

function expirationPreview(days: number) {
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return `Until ${until.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(until.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })}`;
}

/** One control is used by headers, row cells, search results and page mentions. */
export function PageVerificationControl({
  targetId,
  workspaceId: workspaceProp,
  badgeOnly = false,
  showAction = true,
  readOnly = false,
  displayMode = 'all',
  wrap = false,
  placeholder,
  container,
  expectedPropertyId,
}: {
  /** Native cells must match the Cloud generation bound to their field. */
  expectedPropertyId?: string;
  targetId?: string;
  workspaceId?: string;
  badgeOnly?: boolean;
  showAction?: boolean;
  readOnly?: boolean;
  /** Split header actions from breadcrumb status; status also includes expired records. */
  displayMode?: 'all' | 'action' | 'status' | 'cell';
  wrap?: boolean;
  placeholder?: string;
  /** Keep overlays inside a host dialog's focus and stacking boundary. */
  container?: HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceIdOptional();
  const workspaceId = workspaceProp ?? currentWorkspaceId;
  const userId = useAuthenticatedUserIdOptional();
  const published = usePublishContext();
  const store = !published && workspaceId && userId ? verificationStore(workspaceId, userId) : undefined;
  const { data } = useVerification(store, targetId);
  const databaseVerification = useDatabaseVerification();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [screen, setScreen] = useState<'details' | 'verify' | 'custom' | 'upgrade' | 'setup'>('details');
  const [customDate, setCustomDate] = useState(() => addDays(new Date(), 8));
  const [includeTime, setIncludeTime] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const closeWithPointer = useRef(false);

  // A response belongs to the mounted control and the authenticated scope that
  // started it. Returning to the same account/property must not revive an old action.
  const canEdit = !!data?.can_edit && !readOnly;
  const propertyId = data?.property?.id;
  const owner = useRef({
    store,
    userId,
    workspaceId,
    targetId,
    expectedPropertyId,
    propertyId,
    readOnly,
    canEdit,
    epoch: 0,
    active: true,
  });

  if (
    owner.current.store !== store ||
    owner.current.userId !== userId ||
    owner.current.workspaceId !== workspaceId ||
    owner.current.targetId !== targetId ||
    owner.current.expectedPropertyId !== expectedPropertyId ||
    owner.current.propertyId !== propertyId ||
    owner.current.readOnly !== readOnly ||
    owner.current.canEdit !== canEdit
  ) {
    owner.current = {
      store,
      userId,
      workspaceId,
      targetId,
      expectedPropertyId,
      propertyId,
      readOnly,
      canEdit,
      epoch: owner.current.epoch + 1,
      active: owner.current.active,
    };
  }

  const epoch = owner.current.epoch;

  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
    };
  }, []);

  useEffect(() => {
    setOpen(false);
    setTooltipOpen(false);
    setError('');
    setPending(false);
    setUpgradeOpen(false);
  }, [epoch]);

  if (!data || !store || !workspaceId || !targetId) return null;
  if (expectedPropertyId !== undefined && (!expectedPropertyId || data.property?.id !== expectedPropertyId)) return null;
  const hasDatabaseContext = !!data.database_id && databaseVerification.databaseId === data.database_id;
  const needsNativeSetup =
    !!data.database_id && (!data.property || (hasDatabaseContext && !databaseVerification.fieldId));
  const record = data.verification;
  // A date without a time stays verified through the selected local calendar day.
  const customExpiration = includeTime ? customDate : endOfDay(customDate);

  if (!record && (badgeOnly || !canEdit)) return null;
  if ((record && displayMode === 'action') || (!record && displayMode === 'status')) return null;

  const chooseAction = () => {
    setError('');
    setCustomDate(addDays(new Date(), 8));
    setIncludeTime(false);
    setScreen(!data.eligible ? 'upgrade' : needsNativeSetup ? 'setup' : 'verify');
  };

  const ownsAction = () => owner.current.active && owner.current.epoch === epoch;
  const assertCurrentAction = () => {
    const current = ownsAction() ? store.snapshot(targetId).data : undefined;

    if (
      !ownsAction() ||
      !canEdit ||
      !current?.can_edit ||
      current.property?.id !== propertyId ||
      (expectedPropertyId !== undefined && (!expectedPropertyId || current.property?.id !== expectedPropertyId))
    ) {
      throw new Error(
        t('grid.verification.changed', { defaultValue: 'Verification changed. Reopen this control and try again.' })
      );
    }
  };

  const perform = async (action: () => Promise<void>) => {
    if (!ownsAction() || !canEdit || pending) return;
    setPending(true);
    setError('');
    try {
      assertCurrentAction();
      await action();
    } catch (e) {
      if (!ownsAction()) return;
      setError(e instanceof Error ? e.message : 'Could not update verification. Please try again.');
      // Plans and permissions can change while a popover is open.
      void store.refresh(targetId).catch(() => undefined);
    } finally {
      if (ownsAction()) setPending(false);
    }
  };

  const save = (expiration: VerificationExpiration) =>
    perform(async () => {
      const version = store.claimVersion(targetId);
      const result = await verifyPage(workspaceId, targetId, expiration, data.property?.id);

      assertCurrentAction();
      if (!store.acceptMutation(result, targetId, version)) {
        void store.refresh(targetId).catch(() => undefined);
      }

      setOpen(false);
    });
  const remove = (event: MouseEvent<HTMLButtonElement>) => {
    if (!data.eligible) {
      setScreen('upgrade');
      return;
    }

    const fromPointer = event.detail > 0;

    void perform(async () => {
      const current = store.snapshot(targetId).data;

      if (!current || current.property?.id !== data.property?.id || current.verification?.id !== record?.id) {
        throw new Error(
          t('grid.verification.changed', { defaultValue: 'Verification changed. Reopen this control and try again.' })
        );
      }

      const version = store.claimVersion(targetId);
      const result = await removePageVerification(workspaceId, targetId);

      assertCurrentAction();
      closeWithPointer.current = fromPointer;
      if (!store.acceptMutation(result, targetId, version)) {
        void store.refresh(targetId).catch(() => undefined);
      }

      setOpen(false);
    });
  };

  const label = record ? (data.status === 'expired' ? 'Expired' : 'Verified') : 'Verify';
  const cellLabel = record?.expires_at
    ? t(data.status === 'expired' ? 'grid.field.verificationExpired' : 'grid.field.verificationUntil', {
        date: new Date(record.expires_at).toLocaleDateString(i18n.language, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      })
    : t('grid.field.verificationIndefinitely');
  const displayLabel = record && displayMode === 'cell' ? cellLabel : label;
  const tooltip = record ? verificationTooltip(record) : '';
  const button =
    !record && displayMode === 'cell' ? (
      <Button
        variant='ghost'
        type='button'
        aria-label={placeholder || label}
        disabled={pending}
        className={cn(
          'w-full cursor-pointer justify-start rounded-none p-0 text-text-tertiary hover:bg-transparent',
          placeholder ? 'h-auto min-h-5 text-left' : 'h-full min-h-7'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {placeholder}
      </Button>
    ) : !record ? (
      <HeaderToolbarButton
        aria-label={label}
        disabled={pending}
        className={cn(!showAction && !open && 'opacity-0 focus-visible:opacity-100 max-sm:opacity-100')}
        onClick={(event) => event.stopPropagation()}
      >
        <VerifyIcon className='h-5 w-5 text-icon-primary' />
        {label}
      </HeaderToolbarButton>
    ) : (
      <Button
        variant='ghost'
        type='button'
        aria-label={displayLabel}
        disabled={pending}
        className={cn(
          'h-7 shrink-0 gap-1 whitespace-nowrap px-1 py-0.5 focus-visible:ring-2 focus-visible:ring-border-theme-thick',
          displayMode === 'cell' && data.status === 'verified'
            ? 'text-text-primary'
            : data.status === 'verified'
            ? 'text-palette-text-color-13'
            : 'text-text-secondary',
          displayMode === 'cell' &&
            'h-auto min-h-5 max-w-full shrink justify-start rounded-none p-0 leading-5 hover:bg-transparent',
          displayMode === 'cell' && (wrap ? 'whitespace-normal text-left' : 'overflow-hidden')
        )}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {data.status === 'verified' ? (
          <Verified fontSize='small' className='shrink-0 text-palette-text-color-13' />
        ) : (
          <CheckCircleOutline fontSize='small' className='shrink-0' />
        )}
        {!badgeOnly && <span className={displayMode === 'cell' && !wrap ? 'truncate' : undefined}>{displayLabel}</span>}
      </Button>
    );

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setTooltipOpen(false);
          if (next) {
            setError('');
            record ? setScreen('details') : chooseAction();
          }
        }}
      >
        <Tooltip
          disableHoverableContent
          open={Boolean(record) && !open && tooltipOpen}
          onOpenChange={(next) => setTooltipOpen(next && !open)}
        >
          <TooltipTrigger
            asChild
            // Saving restores keyboard focus; only hovering should reveal the tooltip.
            onFocus={(event) => event.preventDefault()}
          >
            <PopoverTrigger
              asChild
              onPointerDown={() => {
                closeWithPointer.current = true;
              }}
              onKeyDown={() => {
                closeWithPointer.current = false;
              }}
            >
              {button}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent container={container ?? undefined} className='break-normal [overflow-wrap:anywhere]'>
            {tooltip}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          container={container}
          align='start'
          onPointerDownCapture={() => {
            closeWithPointer.current = true;
          }}
          onKeyDownCapture={(event) => {
            closeWithPointer.current = false;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setTooltipOpen(false);
            }
          }}
          onCloseAutoFocus={(event) => {
            // Pointer actions must not reopen the tooltip by focusing the badge
            // after the pointer has left. Keyboard users still regain focus.
            if (closeWithPointer.current) event.preventDefault();
            closeWithPointer.current = false;
          }}
          className={cn(
            'border border-border-primary text-sm text-text-primary shadow-menu',
            screen === 'verify' || screen === 'custom' ? 'w-[280px] p-2' : 'w-80 space-y-3 p-4'
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {screen === 'upgrade' ? (
            <>
              <h3 className='font-semibold'>Verify any page with Pro</h3>
              <p>
                Mark important pages as verified so your team can easily identify trusted, up-to-date information.
                Upgrade to Pro to unlock Page Verification.
              </p>
              <Button
                onClick={() => {
                  setOpen(false);
                  setUpgradeOpen(true);
                }}
              >
                Upgrade to Pro
              </Button>
            </>
          ) : screen === 'setup' ? (
            <>
              <h3 className='font-semibold'>Add Verification to the database</h3>
              <p>
                {hasDatabaseContext
                  ? t('grid.verification.setupDescription', {
                      defaultValue:
                        'Add the Verification property before verifying a row page. Its cell and page will share the same verification.',
                    })
                  : t('grid.verification.openDatabaseToSetup', {
                      defaultValue: 'Open the database and add the Verification property before verifying this row.',
                    })}
              </p>
              {hasDatabaseContext && (
                <Button
                  disabled={pending || databaseVerification.readOnly || !databaseVerification.state?.can_edit}
                  onClick={() =>
                    void perform(async () => {
                      if (!data.database_id) return;
                      await databaseVerification.create();
                      // Setup changes the binding. The normal subscriptions load
                      // that generation before a subsequent Verify action.
                      if (ownsAction()) setOpen(false);
                    })
                  }
                >
                  Add Verification
                </Button>
              )}
            </>
          ) : screen === 'verify' ? (
            <>
              <h3 className='px-2 py-1.5 text-xs font-medium leading-[18px] text-text-tertiary'>Verify page</h3>
              <MenuList autoFocus disablePadding aria-label='Verify page'>
                {expirationOptions.map((option) => (
                  <MenuItem
                    key={option.kind}
                    disabled={pending}
                    className='!min-h-8 !items-start !gap-2 !rounded-300 !px-2 !py-1.5 !text-sm !leading-5 !text-text-primary hover:!bg-fill-content-hover focus:!bg-fill-content-hover'
                    onMouseMove={(event) => event.currentTarget.focus()}
                    onClick={() => {
                      if (option.kind === 'custom') {
                        setError('');
                        setScreen('custom');
                      } else {
                        // Seven days uses the existing custom-expiration API for older servers.
                        void save(
                          option.kind === 'seven_days'
                            ? { kind: 'custom', expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }
                            : { kind: option.kind }
                        );
                      }
                    }}
                  >
                    {option.days !== null ? (
                      <ClockIcon aria-hidden='true' className='h-5 w-5 shrink-0' />
                    ) : option.kind === 'indefinitely' ? (
                      <AllInclusive aria-hidden='true' className='!h-5 !w-5 shrink-0' />
                    ) : (
                      <CalendarIcon aria-hidden='true' className='h-5 w-5 shrink-0' />
                    )}
                    <span className='flex flex-col'>
                      <span>{option.label}</span>
                      {option.days !== null && (
                        <span className='text-xs leading-[18px] text-text-secondary'>
                          {expirationPreview(option.days)}
                        </span>
                      )}
                    </span>
                  </MenuItem>
                ))}
              </MenuList>
            </>
          ) : screen === 'custom' ? (
            <>
              <Button
                variant='ghost'
                className='w-full justify-start px-2'
                disabled={pending}
                onClick={() => {
                  setError('');
                  setScreen('verify');
                }}
              >
                <ChevronLeft aria-hidden='true' className='h-4 w-4' />
                Verify page
              </Button>
              <div className={cn(pending && 'pointer-events-none opacity-50')}>
                <MentionDatePicker
                  date={customDate}
                  includeTime={includeTime}
                  reminderOption='none'
                  onDateChange={setCustomDate}
                  onIncludeTimeChange={setIncludeTime}
                />
              </div>
              {customExpiration.getTime() <= Date.now() && (
                <p role='alert' className='px-2 text-text-error'>
                  Choose a future expiration date.
                </p>
              )}
              <Button
                className='mt-2 w-full'
                disabled={pending || !(customExpiration.getTime() > Date.now())}
                onClick={() => void save({ kind: 'custom', expires_at: customExpiration.toISOString() })}
              >
                {record ? 'Renew verification' : 'Verify'}
              </Button>
            </>
          ) : (
            <>
              <h3 className='font-semibold'>{label}</h3>
              {record && (
                <dl className='space-y-2'>
                  <div>
                    <dt className='text-text-secondary'>Verified by</dt>
                    <dd>{record.verified_by.name || 'Unknown user'}</dd>
                  </div>
                  <div>
                    <dt className='text-text-secondary'>Verified on</dt>
                    <dd>{new Date(record.verified_at).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className='text-text-secondary'>Expires on</dt>
                    <dd>{record.expires_at ? new Date(record.expires_at).toLocaleString() : 'Indefinitely'}</dd>
                  </div>
                </dl>
              )}
              {canEdit && (
                <div className='flex flex-col gap-2'>
                  <Button disabled={pending} onClick={chooseAction}>
                    Renew verification
                  </Button>
                  <Button variant='ghost' disabled={pending} onClick={remove}>
                    Remove verification
                  </Button>
                </div>
              )}
            </>
          )}
          {error && (
            <p role='alert' className='text-text-error'>
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {upgradeOpen && <UpgradePlan open onClose={() => setUpgradeOpen(false)} onOpen={() => setUpgradeOpen(true)} />}
    </>
  );
}
