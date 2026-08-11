import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { WorkspaceService } from '@/application/services/domains';
import { SpaceView, Workspace } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useCurrentUserOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';

import { loadDuplicateSelectedWorkspaceId } from './storage';

export function useDuplicate() {
  const isAuthenticated = useIsAuthenticatedOptional();
  const [search, setSearch] = useSearchParams();
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [duplicateOpen, setDuplicateOpen] = React.useState(false);

  useEffect(() => {
    const isDuplicate = search.get('action') === 'duplicate';

    if (!isDuplicate) return;

    setLoginOpen(!isAuthenticated);
    setDuplicateOpen(isAuthenticated);
  }, [isAuthenticated, search, setSearch]);

  const url = window.location.href;

  const handleLoginClose = useCallback(() => {
    setLoginOpen(false);
    setSearch((prev) => {
      prev.delete('action');
      return prev;
    });
  }, [setSearch]);

  const handleDuplicateClose = useCallback(() => {
    setDuplicateOpen(false);
    setSearch((prev) => {
      prev.delete('action');
      return prev;
    });
  }, [setSearch]);

  return {
    loginOpen,
    handleLoginClose,
    url,
    duplicateOpen,
    handleDuplicateClose,
  };
}

export function useLoadWorkspaces() {
  const currentUser = useCurrentUserOptional();
  const isAuthenticated = useIsAuthenticatedOptional() && Boolean(currentUser);
  const [spaceLoading, setSpaceLoading] = useState<boolean>(false);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(loadDuplicateSelectedWorkspaceId);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');

  const [workspaceList, setWorkspaceList] = useState<Workspace[]>([]);

  const [spaceList, setSpaceList] = useState<SpaceView[]>([]);
  const [spaceError, setSpaceError] = useState(false);
  const spaceRequestIdRef = useRef(0);
  const loadedSpaceWorkspaceIdRef = useRef('');

  useEffect(() => {
    return () => {
      spaceRequestIdRef.current += 1;
    };
  }, []);

  const loadWorkspaces = useCallback(async () => {
    if (!isAuthenticated) return;
    setWorkspaceLoading(true);
    try {
      const workspaces = await WorkspaceService.getAll();

      if (workspaces.length > 0) {
        setWorkspaceList(workspaces);
        setSelectedWorkspaceId((prev) => {
          if (!prev || !workspaces.find((item) => item.id === prev)) return workspaces[0].id;
          return prev;
        });
      } else {
        setWorkspaceList([]);
        setSelectedWorkspaceId('');
      }
    } catch (e) {
      notify.error('Failed to load workspaces');
    } finally {
      setWorkspaceLoading(false);
    }
  }, [isAuthenticated]);

  const loadSpaces = useCallback(
    async (selectedWorkspaceId: string) => {
      if (!isAuthenticated) return;
      const requestId = ++spaceRequestIdRef.current;

      if (loadedSpaceWorkspaceIdRef.current !== selectedWorkspaceId) {
        loadedSpaceWorkspaceIdRef.current = selectedWorkspaceId;
        setSpaceList([]);
      }

      setSpaceError(false);
      setSelectedSpaceId('');
      setSpaceLoading(true);
      try {
        const folder = await WorkspaceService.getFolder(selectedWorkspaceId, 2);

        if (requestId !== spaceRequestIdRef.current) return;

        if (!folder) {
          throw new Error('Workspace folder response is empty');
        }

        const spaces = [];

        for (const child of folder.children) {
          if (child.isSpace) {
            spaces.push({
              id: child.id,
              name: child.name,
              isPrivate: child.isPrivate,
              extra: child.extra,
            });
          }
        }

        setSpaceList(spaces);
      } catch (e) {
        if (requestId !== spaceRequestIdRef.current) return;
        console.error('Failed to load spaces', e);
        setSpaceError(true);
      } finally {
        if (requestId === spaceRequestIdRef.current) {
          setSpaceLoading(false);
        }
      }
    },
    [isAuthenticated]
  );

  return {
    workspaceList,
    spaceList,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedSpaceId,
    setSelectedSpaceId,
    workspaceLoading,
    spaceLoading,
    spaceError,
    loadWorkspaces,
    loadSpaces,
  };
}
