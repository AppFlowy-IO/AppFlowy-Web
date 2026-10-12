import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';


import { WorkspaceService } from '@/application/services/domains';
import { captureApiContext } from '@/application/services/js-services/http/request-context';
import { SpaceCreationIntent, SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import { recoverSpaceCreation } from '@/application/services/js-services/space-creation-recovery';
import {
  AccessLevel,
  CreatePagePayload,
  Role,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceVisibility,
  WorkspaceMember,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAppOperations, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import { useSpaceCreationIntent } from '@/components/app/hooks/useSpaceCreationIntent';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
  workspaceMemberDisplayName,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import { SpaceCreationNotice } from '@/components/app/view-actions/SpaceCreationNotice';
import SpaceSettingsPanel, { SpaceSettingsTab } from '@/components/app/view-actions/SpaceSettingsPanel';
import {
  defaultEveryoneElseAccessLevel,
  defaultSpacePermissionSettings,
  SELECTABLE_SPACE_VISIBILITIES,
} from '@/components/app/view-actions/spaceVisibilityOptions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/utils/errors';

import type { KeyboardEvent } from 'react';

const DEFAULT_SPACE_VISIBILITY = SpaceVisibility.Public;
const DRAFT_EXCLUDED_ROLES = [Role.Owner];

type CommittedSpace = {
  spaceId: string;
  initialPageId?: string;
};

type QueuedMember = {
  uid: string;
  userUuid?: string;
  accessLevel: AccessLevel;
};

function permissionSettingsForCreation(settings: SpacePermissionSettings): SpacePermissionSettings {
  return {
    ...settings,
    everyone_else_access_level:
      settings.visibility === SpaceVisibility.Custom ? settings.everyone_else_access_level ?? null : null,
  };
}

type CreateSpaceModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (spaceId: string, initialPageId?: string) => void | Promise<void>;
  initialPage?: CreatePagePayload;
};

function CreateSpaceModal(props: CreateSpaceModalProps) {
  const workspaceId = useCurrentWorkspaceId();
  const recovery = useSpaceCreationIntent(workspaceId);

  return <CreateSpaceDraft key={recovery.store.scopeKey} {...props} recovery={recovery} />;
}

function CreateSpaceDraft({
  open, onClose, onCreated, initialPage: requestedInitialPage, recovery,
}: CreateSpaceModalProps & {
  recovery: { store: SpaceCreationIntentStore; intent?: SpaceCreationIntent; error?: string };
}) {
  const [restored] = useState(() => recovery.intent);
  const initialPage = restored ? restored.initialPage : requestedInitialPage;
  const intentStore = recovery.store;
  const { t } = useTranslation();
  const { createSpace, createSpaceWithInitialPage } = useAppOperations();
  const workspaceId = useCurrentWorkspaceId();
  const creationPermission = useSpaceCreationCapability(workspaceId, open);
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUserOptional();
  const [tab, setTab] = useState<SpaceSettingsTab>('general');
  const [spaceName, setSpaceName] = useState(restored?.payload.name ?? '');
  const [spaceIcon, setSpaceIcon] = useState(restored?.payload.space_icon ?? '');
  const [spaceIconColor, setSpaceIconColor] = useState(restored?.payload.space_icon_color ?? '');
  const [permissionSettings, setPermissionSettings] = useState<SpacePermissionSettings>(() =>
    restored?.payload.permission ?? defaultSpacePermissionSettings(DEFAULT_SPACE_VISIBILITY)
  );
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [loadedWorkspaceMemberDirectoryId, setLoadedWorkspaceMemberDirectoryId] = useState<string | null>(null);
  const [loadingWorkspaceMembers, setLoadingWorkspaceMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<WorkspaceMember[]>(restored?.selectedMembers ?? []);
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [committedSpace, setCommittedSpace] = useState<CommittedSpace | null>(null);
  const [hasAmbiguousCreation, setHasAmbiguousCreation] = useState(Boolean(restored));
  const creatingRef = useRef(false);
  const draftSpaceIdRef = useRef(restored?.payload.view_id ?? uuidv4());
  const draftInitialPageIdRef = useRef(restored?.initialPage?.view_id ?? uuidv4());
  const committedSpaceRef = useRef<CommittedSpace | null>(null);
  const queuedMembersRef = useRef<QueuedMember[]>(restored?.members ?? []);
  const appliedMemberUidsRef = useRef(new Set<string>(restored?.appliedMemberUids ?? []));

  const currentWorkspace = useMemo(() => {
    const workspaces = userWorkspaceInfo?.workspaces ?? [];

    return workspaces.find((workspace) => workspace.id === workspaceId) ?? userWorkspaceInfo?.selectedWorkspace;
  }, [userWorkspaceInfo, workspaceId]);
  const workspaceName = currentWorkspace?.name?.trim() || '';
  const privateOwner = useMemo(
    () => ({
      name: currentUser?.name,
      email: currentUser?.email,
      avatar: currentUser?.avatar,
      workspaceRole: currentWorkspace?.role,
    }),
    [currentUser?.avatar, currentUser?.email, currentUser?.name, currentWorkspace?.role]
  );

  useEffect(() => {
    if (
      !open ||
      permissionSettings.visibility !== SpaceVisibility.Custom ||
      !workspaceId ||
      loadedWorkspaceMemberDirectoryId === workspaceId
    ) {
      return;
    }

    let cancelled = false;

    setWorkspaceMembers([]);
    setLoadingWorkspaceMembers(true);
    void WorkspaceService.getMembers(workspaceId)
      .then((members) => {
        if (cancelled) return;
        setWorkspaceMembers(members);
        setLoadedWorkspaceMemberDirectoryId(workspaceId);
      })
      .catch((error) => {
        if (!cancelled) notify.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspaceMembers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadedWorkspaceMemberDirectoryId, open, permissionSettings.visibility, workspaceId]);

  const selectedMemberUids = useMemo(() => {
    const uids = new Set(selectedMembers.map(getWorkspaceMemberUid).filter((uid): uid is string => Boolean(uid)));
    const currentUserId = userWorkspaceInfo?.userId;

    if (currentUserId !== undefined && currentUserId !== null) uids.add(String(currentUserId));
    return uids;
  }, [selectedMembers, userWorkspaceInfo?.userId]);

  const selectedMemberEmails = useMemo(
    () => new Set(selectedMembers.map((member) => member.email.trim().toLowerCase())),
    [selectedMembers]
  );

  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: selectedMemberUids,
    excludedEmails: selectedMemberEmails,
    excludedRoles: DRAFT_EXCLUDED_ROLES,
    excludePending: true,
  });

  const applyQueuedMembers = useCallback(
    async (spaceId: string) => {
      if (!workspaceId || queuedMembersRef.current.length === 0) return;
      intentStore.assertCurrent();
      const requestContext = captureApiContext();
      const assignmentPermission = await WorkspaceService.getSpacePermission(workspaceId, spaceId);

      intentStore.assertCurrent();
      requestContext.assertCurrent();
      const supportsOverrides = assignmentPermission.member_access_overrides_supported === true;
      const pending = queuedMembersRef.current.filter(({ uid }) => !appliedMemberUidsRef.current.has(uid));
      const results = await Promise.allSettled(
        pending.map(async ({ uid, userUuid, accessLevel }) => {
          intentStore.assertCurrent();
          requestContext.assertCurrent();
          if (supportsOverrides) {
            if (!userUuid) throw new Error(t('space.memberOverride.identityUnavailable'));
            await WorkspaceService.addSpaceMemberByUuid(workspaceId, spaceId, userUuid, { role: SpaceMemberRole.Member });
          } else {
            await WorkspaceService.addSpaceMember(workspaceId, spaceId, { uid, role: SpaceMemberRole.Member, access_level: accessLevel });
          }

          requestContext.assertCurrent();
          intentStore.memberApplied(spaceId, uid);
          appliedMemberUidsRef.current.add(uid);
        })
      );
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (failure) throw failure.reason;
    },
    [workspaceId, t, intentStore]
  );

  const resetDraft = useCallback(() => {
    setTab('general');
    setSpaceName('');
    setSpaceIcon('');
    setSpaceIconColor('');
    setPermissionSettings(defaultSpacePermissionSettings(DEFAULT_SPACE_VISIBILITY));
    setSelectedMembers([]);
    setMemberSearch('');
    setCommittedSpace(null);
    setHasAmbiguousCreation(false);
    committedSpaceRef.current = null;
    queuedMembersRef.current = [];
    appliedMemberUidsRef.current.clear();
    draftSpaceIdRef.current = uuidv4();
    draftInitialPageIdRef.current = uuidv4();
  }, []);

  const finishCreation = useCallback(async () => {
    const committed = committedSpaceRef.current;

    if (!committed) return;
    intentStore.assertCurrent();
    // The full roster is committed before handoff. Keep recovery available if
    // navigation/hydration rejects, and never clear another account's intent.
    await onCreated?.(committed.spaceId, committed.initialPageId);
    intentStore.complete(committed);
    resetDraft();
    onClose();
  }, [onClose, onCreated, resetDraft, intentStore]);

  const finishCommittedClose = useCallback(async () => {
    const committed = committedSpaceRef.current;

    if (!committed || creatingRef.current) return;
    const hasPendingRoster = queuedMembersRef.current.some(({ uid }) => !appliedMemberUidsRef.current.has(uid));

    if (!hasPendingRoster) {
      try { await finishCreation(); }
      catch (error) { notify.error(getErrorMessage(error)); }

      return;
    }

    let completed = false;

    creatingRef.current = true;
    setLoading(true);
    try {
      await applyQueuedMembers(committed.spaceId);
      completed = true;
    } catch (error) {
      notify.error(getErrorMessage(error));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }

    if (completed) {
      try { await finishCreation(); }
      catch (error) { notify.error(getErrorMessage(error)); }
    }
  }, [applyQueuedMembers, finishCreation]);

  const handleClose = useCallback(() => {
    if (creatingRef.current) return;
    if (committedSpaceRef.current) {
      // Do not hand off a partially applied roster. Close retries only the
      // pending member requests against the already committed stable ID.
      void finishCommittedClose();
      return;
    }

    if (hasAmbiguousCreation) {
      // Leave the draft retained; the explicit Retry action performs recovery.
      onClose();
      return;
    }

    resetDraft();
    onClose();
  }, [finishCommittedClose, hasAmbiguousCreation, onClose, resetDraft]);

  const handleSpaceIconChange = useCallback((icon: string, color: string) => {
    setSpaceIcon(icon);
    setSpaceIconColor(color);
  }, []);

  const handleVisibilitySelect = useCallback((visibility: SpaceVisibility) => {
    if (committedSpaceRef.current) return;
    setTab('general');
    setPermissionSettings((current) => {
      const defaults = defaultSpacePermissionSettings(visibility);

      return {
        ...current,
        visibility,
        member_default_access_level: current.member_default_access_level ?? defaults.member_default_access_level,
        everyone_else_access_level:
          visibility === SpaceVisibility.Custom
            ? current.visibility === SpaceVisibility.Custom
              ? current.everyone_else_access_level ?? null
              : defaultEveryoneElseAccessLevel(visibility)
            : null,
      };
    });
  }, []);

  const handleMembersAccessChange = useCallback((value: AccessLevel | null) => {
    if (committedSpaceRef.current) return;
    setPermissionSettings((current) => ({
      ...current,
      member_default_access_level: value,
    }));
  }, []);

  const handleEveryoneElseAccessChange = useCallback((value: AccessLevel | null) => {
    if (committedSpaceRef.current) return;
    setPermissionSettings((current) => ({
      ...current,
      everyone_else_access_level: value,
    }));
  }, []);

  const handleAddDraftMember = useCallback((member: WorkspaceMember) => {
    const uid = getWorkspaceMemberUid(member);

    if (!uid || committedSpaceRef.current) return;
    setSelectedMembers((current) =>
      current.some((selected) => getWorkspaceMemberUid(selected) === uid) ? current : [...current, member]
    );
    setMemberSearch('');
  }, []);

  const handleRemoveDraftMember = useCallback((uid: string) => {
    if (committedSpaceRef.current) return;
    setSelectedMembers((current) => current.filter((member) => getWorkspaceMemberUid(member) !== uid));
  }, []);

  const handleMemberSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // NormalModal treats Enter from a plain input as its primary action. A
    // member query must never create the space before the highlighted person
    // is explicitly added to the local draft.
    if (event.key === 'Enter') event.stopPropagation();
  }, []);

  const handleCreate = useCallback(async () => {
    if (creatingRef.current || !workspaceId) return;
    const trimmedName = spaceName.trim();

    if (!trimmedName) {
      notify.error(t('space.spaceNameCannotBeEmpty'));
      return;
    }

    if (!committedSpaceRef.current && !createSpace && !(initialPage && createSpaceWithInitialPage)) return;

    creatingRef.current = true;
    setLoading(true);
    try {
      let committed = committedSpaceRef.current;

      if (!committed) {
        // A possibly committed stable ID must still be reconciled. A fresh draft rechecks before
        // any writes; denial leaves its name, icon, permission choices and queued people intact.
        if (!hasAmbiguousCreation) {
          const current = await creationPermission.refresh();

          if (!current?.can_create_space) {
            notify.error(t(current ? 'workspacePermissions.denied' : 'workspacePermissions.loadError'));
            return;
          }
        }

        const saved = intentStore.snapshot();

        if (saved) {
          const recovered = await recoverSpaceCreation(workspaceId, saved, () => intentStore.assertCurrent());

          if (recovered) {
            committedSpaceRef.current = recovered;
            setCommittedSpace(recovered);
            intentStore.committed(recovered);
            await applyQueuedMembers(recovered.spaceId);
            await finishCreation();
            return;
          }

          const current = await creationPermission.refresh();

          intentStore.assertCurrent();
          if (!current?.can_create_space) throw new Error(t('workspacePermissions.denied'));
        }

        const visibility = permissionSettings.visibility;
        const spacePayload = {
          name: trimmedName,
          space_icon: spaceIcon,
          space_icon_color: spaceIconColor,
          view_id: draftSpaceIdRef.current,
          client_generated_view_id: true,
          permission: permissionSettingsForCreation(permissionSettings),
        };
        const memberAccessLevel = permissionSettings.member_default_access_level ?? AccessLevel.ReadOnly;

        queuedMembersRef.current =
          visibility === SpaceVisibility.Custom
            ? selectedMembers.flatMap((member) => {
                const uid = getWorkspaceMemberUid(member);

                return uid ? [{ uid, userUuid: member.user_uuid, accessLevel: memberAccessLevel }] : [];
              })
            : [];
        appliedMemberUidsRef.current.clear();

        const savedInitialPage = initialPage ? {
          ...initialPage, view_id: initialPage.view_id ?? draftInitialPageIdRef.current,
        } : undefined;

        intentStore.begin({
          payload: spacePayload, initialPage: savedInitialPage,
          selectedMembers, members: queuedMembersRef.current,
          appliedMemberUids: [...appliedMemberUidsRef.current],
        });
        // Persisted intent is uncertain until the complete authoritative result
        // and queued roster have been handed off, including on browser reload.
        setHasAmbiguousCreation(true);
        if (initialPage) {
          if (!createSpaceWithInitialPage) return;
          const result = await createSpaceWithInitialPage({
            ...spacePayload,
            initial_page: {
              ...initialPage,
              view_id: initialPage.view_id ?? draftInitialPageIdRef.current,
            },
          });

          committed = { spaceId: result.space.view_id, initialPageId: result.page.view_id };
        } else {
          if (!createSpace) return;
          committed = { spaceId: await createSpace(spacePayload) };
        }

        // Record the committed identity before any queued member POST. A retry
        // after a partial failure can only target this space and cannot create
        // a duplicate.
        intentStore.assertCurrent();
        intentStore.committed(committed);
        committedSpaceRef.current = committed;
        setCommittedSpace(committed);
        setHasAmbiguousCreation(false);
      }

      await applyQueuedMembers(committed.spaceId);
      await finishCreation();
    } catch (error) {
      // Once submitted, even a later denial cannot resolve an earlier write.
      // Storage remains untouched; an unsent draft was never persisted.
      try { intentStore.assertCurrent(); } catch { return; }

      if (intentStore.snapshot()) setHasAmbiguousCreation(true);
      notify.error(getErrorMessage(error));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, [
    intentStore,
    workspaceId,
    applyQueuedMembers,
    createSpace,
    createSpaceWithInitialPage,
    finishCreation,
    hasAmbiguousCreation,
    creationPermission,
    initialPage,
    permissionSettings,
    selectedMembers,
    spaceIcon,
    spaceIconColor,
    spaceName,
    t,
  ]);

  const memberControlsDisabled = loading || Boolean(committedSpace) || hasAmbiguousCreation;

  return (
    <SpaceSettingsPanel
      open={open}
      onClose={handleClose}
      title={t('space.createSpace')}
      modalTestId='create-space-modal'
      activeTab={tab}
      onTabChange={setTab}
      membersTabVisible
      membersTabDisabled={false}
      membersContent={
        <div className='appflowy-scroller max-h-[64vh] overflow-y-auto py-2 pr-1'>
          {permissionSettings.visibility !== SpaceVisibility.Custom ? (
            <div className='rounded-400 bg-fill-content-hover px-4 py-3 text-sm text-text-secondary'>
              {t('space.customPermissionDescription')}
            </div>
          ) : (
            <div className='flex flex-col gap-4'>
              <WorkspaceMemberInlineSearch
                search={memberSearch}
                onSearchChange={setMemberSearch}
                addableMembers={addableWorkspaceMembers}
                searchPlaceholder={t('space.permissionManager.searchWorkspaceMembers')}
                addButtonLabel={t('space.permissionManager.addMembers')}
                addResultLabel={t('space.permissionManager.notInSpace')}
                addActionLabel={t('space.permissionManager.add')}
                ownerBadgeLabel={t('space.permissionManager.workspaceOwner')}
                unavailableTitle={t('space.permissionManager.workspaceMemberUidUnavailable')}
                unavailableHint={t('space.permissionManager.workspaceMemberUidUnavailableHint')}
                inputDisabled={memberControlsDisabled || loadingWorkspaceMembers}
                addButtonDisabled={memberControlsDisabled || loadingWorkspaceMembers}
                onInputKeyDown={handleMemberSearchKeyDown}
                onAddMember={handleAddDraftMember}
              />
              {loadingWorkspaceMembers && <Progress />}
              {selectedMembers.length > 0 && (
                <div className='flex flex-col' data-testid='create-space-draft-members'>
                  {selectedMembers.map((member) => {
                    const uid = getWorkspaceMemberUid(member);

                    if (!uid) return null;
                    const displayName = workspaceMemberDisplayName(member);

                    return (
                      <div
                        key={uid}
                        className='flex items-center gap-3 border-b border-border-primary py-3'
                        data-testid={`create-space-draft-member-${uid}`}
                      >
                        <Avatar size='md'>
                          <AvatarImage src={member.avatar_url} alt={member.name} />
                          <AvatarFallback name={displayName}>{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-text-primary'>{displayName}</div>
                          <div className='truncate text-sm text-text-secondary'>{member.email}</div>
                        </div>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          disabled={memberControlsDisabled}
                          aria-label={`${t('space.permissionManager.remove')} ${displayName}`}
                          onClick={() => handleRemoveDraftMember(uid)}
                        >
                          <X aria-hidden='true' className='h-4 w-4' />
                          {t('space.permissionManager.remove')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      }
      spaceName={spaceName}
      spaceIcon={spaceIcon}
      spaceIconColor={spaceIconColor}
      metadataDisabled={memberControlsDisabled}
      onSpaceNameChange={setSpaceName}
      onSpaceIconChange={handleSpaceIconChange}
      permissionSettings={permissionSettings}
      visibilityOptions={SELECTABLE_SPACE_VISIBILITIES}
      permissionSettingsDisabled={memberControlsDisabled}
      workspaceName={workspaceName}
      privateOwner={privateOwner}
      onVisibilitySelect={handleVisibilitySelect}
      onMembersAccessChange={handleMembersAccessChange}
      onEveryoneElseAccessChange={handleEveryoneElseAccessChange}
      onSidebarEditPolicyChange={(sidebar_edit_policy) => {
        if (!committedSpaceRef.current) setPermissionSettings((current) => ({ ...current, sidebar_edit_policy }));
      }}
      showActions
      primaryActionText={committedSpace || hasAmbiguousCreation ? t('button.retry') : t('button.create')}
      primaryActionLoading={loading}
      primaryActionDisabled={loading || Boolean(recovery.error) || !spaceName.trim() || (!committedSpace && !hasAmbiguousCreation && !creationPermission.canCreateSpace)}
      notice={recovery.error ? <p role='alert'>{recovery.error}</p> : committedSpace || hasAmbiguousCreation ? (
        <p role='status'>{t('spaceCreation.retained')}</p>
      ) : <SpaceCreationNotice permission={creationPermission} />}
      onPrimaryAction={() => void handleCreate()}
      overlay={
        loading ? (
          <div
            className='bg-surface-primary/80 absolute inset-0 z-10 flex items-center justify-center rounded-400 backdrop-blur-sm'
            data-testid='create-space-loading-indicator'
          >
            <Progress aria-label={t('loading')} role='status' variant='primary' />
          </div>
        ) : null
      }
    />
  );
}

export default CreateSpaceModal;
