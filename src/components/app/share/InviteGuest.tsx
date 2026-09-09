import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import {
  AccessLevel,
  IPeopleWithAccessType,
  MentionablePerson,
  MentionPersonRole,
  SubscriptionInterval,
  SubscriptionPlan,
  WorkspaceGroup,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CommentIcon } from '@/assets/icons/titlebar_comment.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as ViewIcon } from '@/assets/icons/show.svg';
import { notify } from '@/components/_shared/notify';
import { AccessService, BillingService, WorkspaceService } from '@/application/services/domains';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isAppFlowyHosted } from '@/utils/subscription';

import { EmailTag, InviteInput } from './InviteInput';
import { InviteSuggestion, PersonSuggestionItem } from './PersonSuggestionItem';

const EMAIL_DOMAINS = ['@gmail.com', '@outlook.com', '@yahoo.com'];

interface InviteGuestProps {
  sharedPeople: IPeopleWithAccessType[];
  sharedGroups: WorkspaceGroupViewPermission[];
  isLoadingPeople: boolean;
  mentionable: MentionablePerson[];
  isLoadingMentionable: boolean;
  mentionableError: string | null;
  onInviteSuccess: () => Promise<void>;
  viewId: string;
  hasFullAccess: boolean;
  canGrantFullAccess: boolean;
  canManageGroupAccess: boolean;
  isWorkspaceOwner: boolean;
}

interface InviteSubmission {
  id: number;
  workspaceId: string;
  viewId: string;
}

export function InviteGuest({
  sharedPeople,
  sharedGroups,
  isLoadingPeople,
  mentionable,
  isLoadingMentionable,
  mentionableError,
  onInviteSuccess,
  viewId,
  hasFullAccess,
  canGrantFullAccess,
  canManageGroupAccess,
  isWorkspaceOwner,
}: InviteGuestProps) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState<string>('');
  const [emailTags, setEmailTags] = useState<EmailTag[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoveredIndexRef = useRef<number>(-1);
  const searchValueRef = useRef<string>('');
  const currentWorkspaceId = useCurrentWorkspaceId();
  const latestInviteTargetRef = useRef<{ workspaceId: string | undefined; viewId: string }>({
    workspaceId: currentWorkspaceId,
    viewId,
  });
  const inviteSubmissionSequenceRef = useRef(0);
  const activeInviteSubmissionRef = useRef<InviteSubmission | null>(null);

  // Keep async completion guards current during render, before effects run.
  latestInviteTargetRef.current = { workspaceId: currentWorkspaceId, viewId };

  const [inviteLoading, setInviteLoading] = useState(false);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<AccessLevel>(AccessLevel.ReadOnly);
  const [accessLevelPopoverOpen, setAccessLevelPopoverOpen] = useState(false);
  const canNotInvite = !hasFullAccess;
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  // Combined loading state: show loading when people, mentionable, or group data is loading
  const isLoading = isLoadingPeople || isLoadingMentionable || isLoadingGroups;
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  useEffect(() => {
    latestInviteTargetRef.current = { workspaceId: currentWorkspaceId, viewId };
    inviteSubmissionSequenceRef.current += 1;
    activeInviteSubmissionRef.current = null;
    setEmailTags([]);
    setSearchValue('');
    setIsOpen(false);
    setHoveredIndex(-1);
    setSelectedAccessLevel(AccessLevel.ReadOnly);
    setAccessLevelPopoverOpen(false);
    setUpgradeModalOpen(false);
    setInviteLoading(false);
    hoveredIndexRef.current = -1;
    searchValueRef.current = '';

    return () => {
      inviteSubmissionSequenceRef.current += 1;
      activeInviteSubmissionRef.current = null;
      latestInviteTargetRef.current = { workspaceId: undefined, viewId: '' };
    };
  }, [currentWorkspaceId, viewId]);

  // Group selections made while authority was held must not survive losing it.
  useEffect(() => {
    if (canManageGroupAccess) return;

    setEmailTags((currentTags) =>
      currentTags.some((tag) => tag.kind === 'group') ? currentTags.filter((tag) => tag.kind !== 'group') : currentTags
    );
  }, [canManageGroupAccess]);

  useEffect(() => {
    if (!currentWorkspaceId || !canManageGroupAccess) {
      setWorkspaceGroups([]);
      setIsLoadingGroups(false);
      return;
    }

    // Ignore out-of-order responses after a workspace switch or unmount.
    let cancelled = false;

    setIsLoadingGroups(true);
    void (async () => {
      try {
        const result = await WorkspaceService.getWorkspaceGroups(currentWorkspaceId);

        if (!cancelled) setWorkspaceGroups(result.groups);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setWorkspaceGroups([]);
        }
      } finally {
        if (!cancelled) setIsLoadingGroups(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canManageGroupAccess, currentWorkspaceId]);

  // Clamp during render: a selection made before permissions resolved must
  // never let a user submit a level they cannot grant.
  const effectiveAccessLevel =
    !canGrantFullAccess && selectedAccessLevel === AccessLevel.FullAccess ? AccessLevel.ReadOnly : selectedAccessLevel;

  // Email suggestions based on search input
  const emailSuggestions = useMemo(() => {
    if (!searchValue) return [];

    // If search contains @, check if it matches any email domains
    if (searchValue.includes('@')) {
      const atIndex = searchValue.indexOf('@');
      const userPart = searchValue.substring(0, atIndex);
      const domainPart = searchValue.substring(atIndex);

      // Check if the domain part matches any of our predefined domains
      const matchingDomains = EMAIL_DOMAINS.filter((domain) => domain.startsWith(domainPart));

      if (matchingDomains.length > 0) {
        // Return suggestions with matching domains
        return matchingDomains.map((domain) => userPart + domain);
      } else {
        // No matching domains, return searchValue as suggestion
        return [searchValue];
      }
    }

    // For username input, get already used email domains from tags with same username prefix
    const usedDomainsForSamePrefix = new Set(
      emailTags
        .filter((tag) => {
          const atIndex = tag.email.indexOf('@');

          if (atIndex === -1) return false;
          const userPart = tag.email.substring(0, atIndex);

          return userPart === searchValue; // Only consider tags with same username prefix
        })
        .map((tag) => {
          const atIndex = tag.email.indexOf('@');

          return tag.email.substring(atIndex);
        })
        .filter(Boolean)
    );

    // Filter out domains that are already used for the same username prefix
    return EMAIL_DOMAINS.filter((domain) => !usedDomainsForSamePrefix.has(domain)).map((domain) => searchValue + domain);
  }, [searchValue, emailTags]);

  // Filter mentionable users based on search and exclude already shared people
  const filteredMentionable = useMemo(() => {
    // Get emails of people already shared or already tagged in the input
    const sharedEmails = new Set(sharedPeople.map((person) => person.email));
    const taggedEmails = new Set(emailTags.filter((tag) => tag.kind !== 'group').map((tag) => tag.email));

    // Filter out already shared people
    const unsharedMentionable = mentionable.filter((person) => {
      return !sharedEmails.has(person.email) && !taggedEmails.has(person.email);
    });

    // Then filter by search query
    if (!searchValue) return unsharedMentionable;
    const query = searchValue.toLowerCase();

    return unsharedMentionable.filter(
      (person) => person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query)
    );
  }, [mentionable, searchValue, sharedPeople, emailTags]);

  const filteredGroups = useMemo(() => {
    const sharedGroupIds = new Set(sharedGroups.map((group) => group.group_id));
    const selectedGroupIds = new Set(
      emailTags
        .map((tag) => (tag.kind === 'group' ? tag.groupId : null))
        .filter((groupId): groupId is string => Boolean(groupId))
    );
    const addableGroups = workspaceGroups.filter(
      (group) => !sharedGroupIds.has(group.group_id) && !selectedGroupIds.has(group.group_id)
    );

    if (!searchValue) return addableGroups;

    const query = searchValue.toLowerCase();

    return addableGroups.filter((group) => group.name.toLowerCase().includes(query));
  }, [emailTags, searchValue, sharedGroups, workspaceGroups]);

  // Check if we have people or group data available
  const hasSuggestionData = filteredMentionable.length > 0 || filteredGroups.length > 0;

  // Check if data loading is complete
  const isDataLoadingComplete = !isLoadingMentionable && !isLoadingPeople && !isLoadingGroups;

  // All suggestions (mentionable + email domains)
  const allSuggestions = useMemo(() => {
    const suggestions: InviteSuggestion[] = [];

    filteredGroups.forEach((group) => {
      suggestions.push({ type: 'group', data: group });
    });

    // Add filtered users
    filteredMentionable.forEach((person) => {
      suggestions.push({ type: 'user', data: person });
    });

    if (filteredGroups.length === 0 && filteredMentionable.length === 0) {
      // Add email suggestions
      emailSuggestions.forEach((email) => {
        suggestions.push({ type: 'email', data: email });
      });
    }

    return suggestions;
  }, [filteredGroups, filteredMentionable, emailSuggestions]);

  useEffect(() => {
    hoveredIndexRef.current = hoveredIndex;
    searchValueRef.current = searchValue;
  }, [hoveredIndex, searchValue]);

  useEffect(() => {
    if (allSuggestions.length > 0) {
      setHoveredIndex(0);
    } else {
      setHoveredIndex(-1);
    }
  }, [allSuggestions]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Never allow opening popover during data loading
      if (open && !isDataLoadingComplete) {
        return;
      }

      // After loading is complete, check opening conditions
      if (open && isDataLoadingComplete) {
        const hasUserInput = searchValue.length > 0;

        // If we have users or groups, allow opening on focus
        if (hasSuggestionData) {
          setIsOpen(true);
          return;
        }

        // If no people/group data, only open if user has typed something
        if (!hasSuggestionData && hasUserInput && allSuggestions.length > 0) {
          setIsOpen(true);
          return;
        }

        setIsOpen(false);
        return;
      }

      setIsOpen(open);
    },
    [isDataLoadingComplete, hasSuggestionData, searchValue, allSuggestions.length]
  );

  // Handle input focus to potentially open popover
  const handleInputClick = useCallback(() => {
    if (canNotInvite) {
      return;
    }

    // Never open popover during data loading
    if (!isDataLoadingComplete) {
      setIsOpen(false);
      return;
    }

    // If we have users or groups, open popover on focus
    if (hasSuggestionData) {
      setIsOpen(true);
      return;
    }

    // If no mentionable data, only open if user has already typed something
    const hasUserInput = searchValue.length > 0;

    if (hasUserInput && allSuggestions.length > 0) {
      setIsOpen(true);
      return;
    }

    setIsOpen(false);
    // Otherwise, don't open on focus when data is empty
  }, [isDataLoadingComplete, hasSuggestionData, searchValue, allSuggestions.length, canNotInvite]);

  // Handle input change and potentially open popover
  const handleInputChange = useCallback(
    (value: string) => {
      setSearchValue(value);

      // Never open popover during data loading, even when user types
      if (!isDataLoadingComplete) {
        return;
      }

      // After loading is complete, open popover if user has typed and we have suggestions
      if (value && !isOpen) {
        const willHaveEmailSuggestions = value && !value.includes('@');
        const willHaveUserOrGroupSuggestions = hasSuggestionData;

        if (willHaveEmailSuggestions || willHaveUserOrGroupSuggestions) {
          setIsOpen(true);
          return;
        }
      }

      if (!value && !hasSuggestionData && isOpen) {
        setIsOpen(false);
      }
    },
    [isDataLoadingComplete, hasSuggestionData, isOpen]
  );

  const handleInvite = useCallback(
    (emailOrUserOrGroup: string | MentionablePerson | WorkspaceGroup) => {
      if (typeof emailOrUserOrGroup !== 'string' && 'group_id' in emailOrUserOrGroup) {
        if (!canManageGroupAccess) return;

        const group = emailOrUserOrGroup;
        const newTag: EmailTag = {
          id: `group:${group.group_id}`,
          email: group.name,
          avatar: '',
          name: group.name,
          kind: 'group',
          groupId: group.group_id,
          memberCount: group.member_count,
        };

        setEmailTags((prev) =>
          prev.some((tag) => tag.kind === 'group' && tag.groupId === group.group_id) ? prev : [...prev, newTag]
        );
        setSearchValue('');
        setIsOpen(false);
        return;
      }

      const emailOrUser = emailOrUserOrGroup;
      const isNew = typeof emailOrUser === 'string';
      const email = typeof emailOrUser === 'string' ? emailOrUser : emailOrUser.email;
      const isGuest = typeof emailOrUser === 'string' ? true : emailOrUser.role === MentionPersonRole.Guest;

      // Add email to tags instead of immediately inviting
      const newTag: EmailTag = {
        id: `user:${email}`,
        email: email,
        new: isNew,
        isGuest: isGuest,
        avatar: typeof emailOrUser === 'string' ? '' : emailOrUser.avatar_url || '',
        name: typeof emailOrUser === 'string' ? undefined : emailOrUser.name, // Include name if from mentionable list
        kind: 'user',
      };

      setEmailTags((prev) =>
        prev.some((tag) => tag.kind !== 'group' && tag.email === email) ? prev : [...prev, newTag]
      );

      setSearchValue('');
      setIsOpen(false);
    },
    [canManageGroupAccess]
  );

  const handleEmailTagsChange = useCallback((newTags: EmailTag[]) => {
    setEmailTags(newTags);
  }, []);

  const getAccessLevelText = useCallback(
    (accessLevel: AccessLevel) => {
      switch (accessLevel) {
        case AccessLevel.FullAccess:
          return t('shareAction.fullAccess');
        case AccessLevel.ReadAndWrite:
          return t('shareAction.canEdit');
        case AccessLevel.ReadAndComment:
          return t('shareAction.canComment');
        case AccessLevel.ReadOnly:
          return t('shareAction.canView');
        default:
          return t('shareAction.canView');
      }
    },
    [t]
  );

  const handleAccessLevelSelect = useCallback((accessLevel: AccessLevel) => {
    setSelectedAccessLevel(accessLevel);
    setAccessLevelPopoverOpen(false);
  }, []);

  const renderAccessLevelSelector = useCallback(() => {
    if (emailTags.length === 0) return null;

    return (
      <Popover open={accessLevelPopoverOpen} onOpenChange={setAccessLevelPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            onMouseDown={(e) => e.preventDefault()}
            variant='ghost'
            size='sm'
            className='relative top-[-0.5px] h-6 px-2'
          >
            {getAccessLevelText(effectiveAccessLevel)}
            <ArrowDownIcon className='h-3 w-3 text-icon-secondary' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className='w-64 p-2'
          align='start'
          sideOffset={8}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
            onClick={() => handleAccessLevelSelect(AccessLevel.ReadOnly)}
          >
            <div className='flex items-center gap-2'>
              <ViewIcon className='h-4 w-4' />
              <div className='flex flex-col'>
                <div className='text-sm text-text-primary'>{t('shareAction.canView')}</div>
                <div className='text-xs text-text-tertiary'>{t('shareAction.canViewDescription')}</div>
              </div>
            </div>
            {effectiveAccessLevel === AccessLevel.ReadOnly && <DropdownMenuItemTick />}
          </div>
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
            onClick={() => handleAccessLevelSelect(AccessLevel.ReadAndComment)}
          >
            <div className='flex items-center gap-2'>
              <CommentIcon className='h-4 w-4' />
              <div className='flex flex-col'>
                <div className='text-sm text-text-primary'>{t('shareAction.canComment')}</div>
                <div className='text-xs text-text-tertiary'>{t('shareAction.canCommentDescription')}</div>
              </div>
            </div>
            {effectiveAccessLevel === AccessLevel.ReadAndComment && <DropdownMenuItemTick />}
          </div>
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
            onClick={() => handleAccessLevelSelect(AccessLevel.ReadAndWrite)}
          >
            <div className='flex items-center gap-2'>
              <EditIcon className='h-4 w-4' />
              <div className='flex flex-col'>
                <div className='text-sm text-text-primary'>{t('shareAction.canEdit')}</div>
                <div className='text-xs text-text-tertiary'>{t('shareAction.canEditDescription')}</div>
              </div>
            </div>
            {effectiveAccessLevel === AccessLevel.ReadAndWrite && <DropdownMenuItemTick />}
          </div>
          {canGrantFullAccess && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
              onClick={() => handleAccessLevelSelect(AccessLevel.FullAccess)}
            >
              <div className='flex items-center gap-2'>
                <CrownIcon className='h-4 w-4' />
                <div className='flex flex-col'>
                  <div className='text-sm text-text-primary'>{t('shareAction.fullAccess')}</div>
                  <div className='text-xs text-text-tertiary'>{t('shareAction.fullAccessDescription')}</div>
                </div>
              </div>
              {effectiveAccessLevel === AccessLevel.FullAccess && <DropdownMenuItemTick />}
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }, [
    emailTags.length,
    accessLevelPopoverOpen,
    getAccessLevelText,
    effectiveAccessLevel,
    t,
    canGrantFullAccess,
    handleAccessLevelSelect,
  ]);

  const handleUpgrade = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const workspaceId = currentWorkspaceId;

    if (!workspaceId) return;
    if (!isWorkspaceOwner) {
      toast.error('Please ask the workspace owner to upgrade to Pro to unlock guest editors.');
      return;
    }

    if (!isAppFlowyHosted()) {
      // Self-hosted instances have Pro features enabled by default
      return;
    }

    const plan = SubscriptionPlan.Pro;

    try {
      setUpgradeLoading(true);
      const link = await BillingService.getSubscriptionLink(workspaceId, plan, SubscriptionInterval.Month);

      window.open(link, '_blank');
      setUpgradeModalOpen(false);

      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUpgradeLoading(false);
    }
  }, [currentWorkspaceId, isWorkspaceOwner]);

  const handleSendInvites = useCallback(async () => {
    if (!currentWorkspaceId) return;
    if (emailTags.length === 0) return;

    const activeSubmission = activeInviteSubmissionRef.current;

    if (activeSubmission?.workspaceId === currentWorkspaceId && activeSubmission.viewId === viewId) {
      return;
    }

    const pendingInvites = emailTags.filter(
      (tag) => tag.kind !== 'group' || (canManageGroupAccess && Boolean(tag.groupId))
    );

    if (pendingInvites.length === 0) return;

    const submission: InviteSubmission = {
      id: ++inviteSubmissionSequenceRef.current,
      workspaceId: currentWorkspaceId,
      viewId,
    };
    const isCurrentSubmission = () => {
      const latestTarget = latestInviteTargetRef.current;

      return (
        activeInviteSubmissionRef.current?.id === submission.id &&
        latestTarget.workspaceId === submission.workspaceId &&
        latestTarget.viewId === submission.viewId
      );
    };

    activeInviteSubmissionRef.current = submission;

    try {
      setInviteLoading(true);
      const results = await Promise.allSettled(
        pendingInvites.map(async (tag) => {
          if (tag.kind === 'group' && tag.groupId) {
            await AccessService.sharePageToGroup(currentWorkspaceId, viewId, tag.groupId, effectiveAccessLevel);
          } else {
            await AccessService.sharePageTo(currentWorkspaceId, viewId, [tag.email], effectiveAccessLevel);
          }

          return tag.id;
        })
      );
      const successfulTagIds = new Set(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      );
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (!isCurrentSubmission()) return;

      if (successfulTagIds.size > 0) {
        setEmailTags((currentTags) => currentTags.filter((tag) => !successfulTagIds.has(tag.id)));
        setSearchValue('');
      }

      if (failures.length === 0) {
        notify.success(t('shareAction.inviteSuccess'));
      } else {
        const errors = failures.map(({ reason }) =>
          typeof reason === 'object' && reason !== null
            ? (reason as { code?: number; message?: string })
            : { message: String(reason) }
        );
        const error =
          errors.find(
            ({ code }) =>
              code === ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED || code === ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED
          ) ?? errors[0];

        if (
          error.code === ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED ||
          error.code === ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED
        ) {
          if (isAppFlowyHosted()) {
            setUpgradeModalOpen(true);
          } else {
            notify.error(error.message ?? t('settings.appearance.members.inviteFailedDialogTitle'));
          }
        } else {
          notify.error(error.message ?? t('settings.appearance.members.inviteFailedDialogTitle'));
        }
      }

      if (successfulTagIds.size > 0) {
        await onInviteSuccess();
      }
    } finally {
      if (isCurrentSubmission()) {
        activeInviteSubmissionRef.current = null;
        setInviteLoading(false);
      }
    }
  }, [canManageGroupAccess, currentWorkspaceId, emailTags, onInviteSuccess, viewId, t, effectiveAccessLevel]);

  const commitCurrentSearchValue = useCallback(
    (preferSuggestion: boolean) => {
      const trimmedValue = searchValueRef.current.trim();
      const currentHovered = hoveredIndexRef.current;

      if (preferSuggestion && currentHovered >= 0 && currentHovered < allSuggestions.length) {
        const suggestion = allSuggestions[currentHovered];

        if (suggestion.type !== 'email' || !trimmedValue.includes('@')) {
          handleInvite(suggestion.data);
          return true;
        }
      }

      if (trimmedValue.includes('@')) {
        handleInvite(trimmedValue);
        return true;
      }

      return false;
    },
    [allSuggestions, handleInvite]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Backspace' && searchValue === '' && emailTags.length > 0) {
        e.preventDefault();
        setEmailTags((prev) => prev.slice(0, -1));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const currentHovered = hoveredIndexRef.current;

        if (currentHovered >= 0 && currentHovered < allSuggestions.length) {
          const suggestion = allSuggestions[currentHovered];

          handleInvite(suggestion.data);
        } else if (searchValueRef.current.includes('@')) {
          // If user typed a full email
          handleInvite(searchValueRef.current);
        } else if (searchValueRef.current === '' && emailTags.length > 0) {
          void handleSendInvites();
        }
      } else if (e.key === ',') {
        e.preventDefault();
        commitCurrentSearchValue(true);
      } else if (e.key === 'ArrowDown') {
        if (allSuggestions.length === 0) return;
        e.preventDefault();
        setHoveredIndex((prev) => (prev + 1) % allSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        if (allSuggestions.length === 0) return;
        e.preventDefault();
        setHoveredIndex((prev) => (prev <= 0 ? allSuggestions.length - 1 : prev - 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [allSuggestions, commitCurrentSearchValue, emailTags.length, handleInvite, searchValue, handleSendInvites]
  );

  const renderContent = () => {
    const hasResults = allSuggestions.length > 0;

    // Different label logic based on data availability and search state
    let labelText;

    if (!hasSuggestionData) {
      // No user or group data available
      labelText = searchValue ? t('shareAction.keepTypingEmailOrGroup') : '';
    } else {
      // Have users or groups
      labelText =
        searchValue && !hasResults ? t('shareAction.keepTypingEmailOrGroup') : t('shareAction.notInvitedToPage');
    }

    return (
      <div className='p-2'>
        <Label className='px-2 py-1.5'>{labelText}</Label>

        {mentionableError && <Label className='block px-2 py-1.5 text-text-error'>{mentionableError}</Label>}

        {!hasResults && searchValue && (
          <div className='py-4 text-center text-sm text-text-tertiary'>{t('shareAction.noResults')}</div>
        )}

        {hasResults && (
          <div className='max-h-[200px] space-y-1 overflow-y-auto'>
            {allSuggestions.map((suggestion, index) => (
              <PersonSuggestionItem
                key={`${suggestion.type}-${
                  suggestion.type === 'email'
                    ? suggestion.data
                    : suggestion.type === 'group'
                    ? suggestion.data.group_id
                    : suggestion.data.email
                }`}
                suggestion={suggestion}
                isHovered={index === hoveredIndex}
                onMouseEnter={() => setHoveredIndex(index)}
                onClick={() => handleInvite(suggestion.data)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderInviteInput = useCallback(
    (readOnly: boolean) => {
      return (
        <InviteInput
          autoFocus
          readOnly={readOnly}
          inputRef={inputRef}
          inputValue={searchValue}
          onInputChange={handleInputChange}
          emailTags={emailTags}
          onEmailTagsChange={handleEmailTagsChange}
          onKeyDown={handleKeyDown}
          placeholder={t('shareAction.inviteByEmailOrGroup')}
          getTagTooltip={(tag) =>
            tag.kind === 'group'
              ? t('shareAction.shareWithGroupTooltip', { group: tag.name || tag.email })
              : t('shareAction.inviteAsGuestTooltip', { email: tag.email })
          }
          multiple={true}
          disabled={isLoading}
          onClick={handleInputClick}
          afterExtra={renderAccessLevelSelector()}
        />
      );
    },
    [
      searchValue,
      handleInputChange,
      emailTags,
      handleEmailTagsChange,
      handleKeyDown,
      t,
      isLoading,
      handleInputClick,
      renderAccessLevelSelector,
    ]
  );

  return (
    <>
      <div className='flex w-full items-center justify-start gap-1.5 px-2'>
        <div className='relative flex flex-1 items-center overflow-hidden'>
          {canNotInvite ? (
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>{renderInviteInput(true)}</TooltipTrigger>
              <TooltipContent>{t('shareAction.onlyFullAccess')}</TooltipContent>
            </Tooltip>
          ) : (
            renderInviteInput(false)
          )}

          {/* Invisible anchor for popover positioning */}
          <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <div className='pointer-events-none absolute inset-0 z-[-1]' />
            </PopoverTrigger>
            <PopoverContent
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              className='w-[--radix-popover-trigger-width] max-w-sm'
              side='bottom'
              align='start'
              onMouseDown={(e) => e.preventDefault()}
            >
              {renderContent()}
            </PopoverContent>
          </Popover>
        </div>

        <Button
          className='min-w-[76px]'
          size={'default'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSendInvites}
          loading={inviteLoading}
          disabled={canNotInvite || emailTags.length === 0 || isLoading}
        >
          {inviteLoading && <Progress />}
          {t('shareAction.invite')}
        </Button>
      </div>

      {/* Upgrade Confirmation Dialog */}
      <Dialog open={upgradeModalOpen} onOpenChange={setUpgradeModalOpen}>
        <DialogContent size='sm'>
          <DialogHeader>
            <DialogTitle>{t('shareAction.upgradeConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('shareAction.upgradeConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setUpgradeModalOpen(false)}>
              {t('button.cancel')}
            </Button>
            <Button onClick={handleUpgrade} loading={upgradeLoading}>
              {t('shareAction.upgrade')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
