import React, { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useIsAuthenticatedOptional } from '@/components/main/app.hooks';

export function useImport (force?: boolean) {
  const isAuthenticated = useIsAuthenticatedOptional();
  const [search, setSearch] = useSearchParams();
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const url = window.location.href;
  const source = search.get('source');

  useEffect(() => {
    const isImport = search.get('action') === 'import';

    if (!isImport) return;
    setLoginOpen(!isAuthenticated);
    setOpen(isAuthenticated);
  }, [force, isAuthenticated, search, setSearch]);

  const handleLoginClose = useCallback(() => {
    setLoginOpen(false);
    setSearch((prev) => {
      prev.delete('action');
      prev.delete('source');
      return prev;
    });
  }, [setSearch]);

  const handleImportClose = useCallback(() => {
    setOpen(false);
    setSearch((prev) => {
      prev.delete('action');
      prev.delete('source');
      return prev;
    });
  }, [setSearch]);

  return {
    loginOpen,
    handleLoginClose,
    url,
    open,
    handleImportClose,
    source,
  };
}