import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo } from 'react';

import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { getOutlineOpen, getOutlineWidth, setOutlineOpen, setOutlineWidth } from '@/utils/safe-storage';

export interface OutlineProps {
  onOpenDrawer: () => void;
  openDrawer: boolean;
  onCloseDrawer: () => void;
}

export function useOutlinePopover ({
  onOpenDrawer, openDrawer, onCloseDrawer,
}: OutlineProps) {
  const [openPopover, setOpenPopover] = React.useState(false);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    switch (true) {

      case createHotkey(HOT_KEY_NAME.TOGGLE_SIDEBAR)(e):
        e.preventDefault();
        if (openDrawer) {
          onCloseDrawer();
        } else {
          onOpenDrawer();
        }

        break;
      default:
        break;
    }
  }, [onCloseDrawer, onOpenDrawer, openDrawer]);

  useEffect(() => {

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onKeyDown]);

  const debounceClosePopover = useMemo(() => {
    return debounce(() => {
      setOpenPopover(false);
    }, 200);
  }, []);

  const handleOpenPopover = useCallback(() => {
    debounceClosePopover.cancel();
    if (openDrawer) {
      return;
    }

    setOpenPopover(true);
  }, [openDrawer, debounceClosePopover]);

  const handleClosePopover = useCallback(() => {
    setOpenPopover(false);
  }, []);

  const debounceOpenPopover = useMemo(() => {
    debounceClosePopover.cancel();
    return debounce(handleOpenPopover, 100);
  }, [handleOpenPopover, debounceClosePopover]);

  return {
    openPopover,
    debounceClosePopover,
    debounceOpenPopover,
    handleClosePopover,
    handleOpenPopover,
  };
}

export function useOutlineDrawer () {
  const [drawerWidth, setDrawerWidth] = React.useState(() => {
    return getOutlineWidth(268);
  });

  const [drawerOpened, setDrawerOpened] = React.useState(() => {
    if (window.innerWidth - drawerWidth <= 768) {
      return false;
    }

    return getOutlineOpen(false);
  });

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth - drawerWidth <= 768) {
        setDrawerOpened(false);
      } else if (!getOutlineOpen(true)) {
        // Stored value is explicitly 'false'; any unreadable storage falls back to open.
        setDrawerOpened(false);
      } else {
        setDrawerOpened(true);
      }
    };

    onResize();

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [drawerWidth]);

  const handleResize = useCallback((width: number) => {
    setOutlineWidth(width);
    setDrawerWidth(width);
  }, []);

  const toggleOpenDrawer = useCallback((status: boolean) => {
    if (status && window.innerWidth - drawerWidth <= 768) {
      handleResize(268);
    }

    setOutlineOpen(status);
    setDrawerOpened(status);
  }, [handleResize, drawerWidth]);

  return {
    toggleOpenDrawer,
    drawerWidth,
    setDrawerWidth: handleResize,
    drawerOpened,
  };

}