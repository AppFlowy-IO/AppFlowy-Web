import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import {
  AccessLevel,
  IPeopleWithAccessType,
  MentionablePerson,
  MentionPersonRole,
  Role,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as ViewIcon } from '@/assets/icons/show.svg';
import { notify } from '@/components/_shared/notify';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';
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
import { PersonSuggestionItem } from './PersonSuggestionItem';

const EMAIL_DOMAINS = ['@gmail.com', '@outlook.com', '@yahoo.com'];

interface InviteGuestProps {
  sharedPeople: IPeopleWithAccessType[];
  isLoadingPeople: boolean;
  mentionable: MentionablePerson[];
  isLoadingMentionable: boolean;
  mentionableError: string | null;
  onInviteSuccess: () => Promise<void>;
  viewId: string;
  hasFullAccess: boolean;
  activeSubscriptionPlan: SubscriptionPlan | null;
}

export function InviteGuest({
  sharedPeople,
  isLoadingPeople,
  mentionable,
  isLoadingMentionable,
  mentionableError,
  onInviteSuccess,
  viewId,
  hasFullAccess,
}: InviteGuestProps) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState<string>('');
  const [emailTags, setEmailTags] = useState<EmailTag[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoveredIndexRef = useRef<number>(-1);
  const searchValueRef = useRef<string>('');
  const service = useService();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const [inviteLoading, setInviteLoading] = useState(false);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<AccessLevel>(AccessLevel.ReadOnly);
  const [accessLevelPopoverOpen, setAccessLevelPopoverOpen] = useState(false);
  const canNotInvite = !hasFullAccess;
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  // Combined loading state: show loading when either people or mentionable data is loading
  const isLoading = isLoadingPeople || isLoadingMentionable;
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.role === Role.Owner;

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
    // Get emails of people already shared
    const sharedEmails = new Set(sharedPeople.map((person) => person.email));

    // Filter out already shared people
    const unsharedMentionable = mentionable.filter((person) => {
      return !sharedEmails.has(person.email) && !emailTags.some((tag) => tag.email === person.email);
    });

    // Then filter by search query
    if (!searchValue) return unsharedMentionable;
    const query = searchValue.toLowerCase();

    return unsharedMentionable.filter(
      (person) => person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query)
    );
  }, [mentionable, searchValue, sharedPeople, emailTags]);

  // Check if we have mentionable data available
  const hasMentionableData = filteredMentionable.length > 0;

  // Check if data loading is complete
  const isDataLoadingComplete = !isLoadingMentionable && !isLoadingPeople;

  // All suggestions (mentionable + email domains)
  const allSuggestions = useMemo(() => {
    const suggestions: Array<{ type: 'user' | 'email'; data: MentionablePerson | string }> = [];

    // Add filtered users
    filteredMentionable.forEach((person) => {
      suggestions.push({ type: 'user', data: person });
    });

    if (filteredMentionable.length === 0) {
      // Add email suggestions
      emailSuggestions.forEach((email) => {
        suggestions.push({ type: 'email', data: email });
      });
    }

    return suggestions;
  }, [filteredMentionable, emailSuggestions]);

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

        // If we have mentionable data, allow opening on focus
        if (hasMentionableData) {
          setIsOpen(true);
          return;
        }

        // If no mentionable data, only open if user has typed something
        if (!hasMentionableData && hasUserInput && allSuggestions.length > 0) {
          setIsOpen(true);
          return;
        }

        setIsOpen(false);
        return;
      }

      setIsOpen(open);
    },
    [isDataLoadingComplete, hasMentionableData, searchValue, allSuggestions.length]
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

    // If we have mentionable data, open popover on focus
    if (hasMentionableData) {
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
  }, [isDataLoadingComplete, hasMentionableData, searchValue, allSuggestions.length, canNotInvite]);

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
        const willHaveUserSuggestions = hasMentionableData;

        if (willHaveEmailSuggestions || willHaveUserSuggestions) {
          setIsOpen(true);
          return;
        }
      }

      if (!value && !hasMentionableData && isOpen) {
        setIsOpen(false);
      }
    },
    [isDataLoadingComplete, hasMentionableData, isOpen]
  );

  const handleInvite = useCallback(
    (emailOrUser: string | MentionablePerson) => {
      const isNew = typeof emailOrUser === 'string';
      const email = typeof emailOrUser === 'string' ? emailOrUser : emailOrUser.email;
      const isGuest = typeof emailOrUser === 'string' ? true : emailOrUser.role === MentionPersonRole.Guest;

      // Add email to tags instead of immediately inviting
      const newTag: EmailTag = {
        id: Date.now().toString(),
        email: email,
        new: isNew,
        isGuest: isGuest,
        avatar: typeof emailOrUser === 'string' ? '' : emailOrUser.avatar_url || '',
        name: typeof emailOrUser === 'string' ? undefined : emailOrUser.name, // Include name if from mentionable list
      };

      // Check if email already exists in tags
      const emailExists = emailTags.some((tag) => tag.email === email);

      if (!emailExists) {
        setEmailTags((prev) => [...prev, newTag]);
      }

      setSearchValue('');
      setIsOpen(false);
    },
    [emailTags]
  );

  const handleEmailTagsChange = useCallback((newTags: EmailTag[]) => {
    setEmailTags(newTags);
  }, []);

  const getAccessLevelText = useCallback(
    (accessLevel: AccessLevel) => {
      switch (accessLevel) {
        case AccessLevel.ReadAndWrite:
          return t('shareAction.canEdit');
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
            {getAccessLevelText(selectedAccessLevel)}
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
            {selectedAccessLevel === AccessLevel.ReadOnly && <DropdownMenuItemTick />}
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
            {selectedAccessLevel === AccessLevel.ReadAndWrite && <DropdownMenuItemTick />}
          </div>
        </PopoverContent>
      </Popover>
    );
  }, [emailTags.length, accessLevelPopoverOpen, getAccessLevelText, selectedAccessLevel, t, handleAccessLevelSelect]);

  const handleUpgrade = useCallback(async () => {
    if (!service || !currentWorkspaceId) return;
    const workspaceId = currentWorkspaceId;

    if (!workspaceId) return;
    if (!isOwner) {
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
      const link = await service.getSubscriptionLink(workspaceId, plan, SubscriptionInterval.Month);

      window.open(link, '_blank');
      setUpgradeModalOpen(false);

      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUpgradeLoading(false);
    }
  }, [currentWorkspaceId, service, isOwner]);

  const handleSendInvites = useCallback(async () => {
    if (!service || !currentWorkspaceId) return;
    if (emailTags.length === 0) return;

    try {
      setInviteLoading(true);
      await service.sharePageTo(
        currentWorkspaceId,
        viewId,
        emailTags.map((tag) => tag.email),
        selectedAccessLevel
      );
      notify.success(t('shareAction.inviteSuccess'));
      // eslint-disable-next-line
    } catch (error: any) {
      if (error.code === ERROR_CODE.NOT_HAS_PERMISSION_TO_INVITE_GUEST) {
        setUpgradeModalOpen(true);
        return;
      }

      notify.error(error.message);
    } finally {
      setInviteLoading(false);
    }

    // Clear tags after successful invite
    setEmailTags([]);
    setSearchValue('');

    // Notify parent component to refresh the people list
    await onInviteSuccess();
  }, [service, currentWorkspaceId, emailTags, onInviteSuccess, viewId, t, selectedAccessLevel]);

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
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHoveredIndex((prev) => (prev + 1) % allSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHoveredIndex((prev) => (prev <= 0 ? allSuggestions.length - 1 : prev - 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [allSuggestions, emailTags.length, handleInvite, searchValue, handleSendInvites]
  );

  const renderContent = () => {
    // Show error if mentionable data failed to load
    if (mentionableError) {
      return (
        <div className='p-4'>
          <Label className='text-text-error'>{mentionableError}</Label>
        </div>
      );
    }

    const hasResults = allSuggestions.length > 0;

    // Different label logic based on data availability and search state
    let labelText;

    if (!hasMentionableData) {
      // No mentionable data available
      labelText = searchValue ? t('shareAction.keepTypingEmail') : '';
    } else {
      // Have mentionable data
      labelText = searchValue && !hasResults ? t('shareAction.keepTypingEmail') : t('shareAction.notInvitedToPage');
    }

    return (
      <div className='p-2'>
        <Label className='px-2 py-1.5'>{labelText}</Label>

        {!hasResults && searchValue && (
          <div className='py-4 text-center text-sm text-text-tertiary'>{t('shareAction.noResults')}</div>
        )}

        {hasResults && (
          <div className='max-h-[200px] space-y-1 overflow-y-auto'>
            {allSuggestions.map((suggestion, index) => (
              <PersonSuggestionItem
                key={`${suggestion.type}-${typeof suggestion.data === 'string' ? suggestion.data : suggestion.data.email
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
          placeholder={t('shareAction.inviteByEmail')}
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
          disabled={emailTags.length === 0 || isLoading}
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
