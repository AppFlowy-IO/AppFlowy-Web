import { EditorData } from '@appflowyinc/editor';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import AIChatDrawer from '@/components/ai-chat/AIChatDrawer';
import { useAIEnabled, useAppViewId } from '@/components/app/app.hooks';

const DEFAULT_WIDTH = 600;

export const AIChatContext = React.createContext<{
  chatId?: string;
  selectionMode: boolean;
  onOpenSelectionMode: () => void;
  onCloseSelectionMode: () => void;
  openViewId: string | null;
  onOpenView: (viewId: string, insertData?: EditorData) => void;
  onCloseView: () => void;
  drawerWidth: number;
  onSetDrawerWidth: (width: number) => void;
  getInsertData: (viewId: string) => EditorData | undefined;
  clearInsertData: (viewId: string) => void;
  setDrawerOpen: (open: boolean) => void;
  drawerOpen?: boolean;
  enabled: boolean;
} | undefined>(undefined);

export function useAIChatContext() {
  const context = React.useContext(AIChatContext);

  if(!context) {
    throw new Error('useAIChatContext must be used within a AIChatProvider');
  }

  return context;
}

// Optional version that returns undefined if provider is not available
export function useAIChatContextOptional() {
  return React.useContext(AIChatContext);
}

export function AIChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const chatId = useAppViewId();
  const enabled = useAIEnabled();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openViewId, setOpenViewId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH);
  const [insertData, setInsertData] = useState<Map<string, EditorData>>(new Map());

  useEffect(() => {
    setSelectionMode(false);
    setOpenViewId(null);
    setDrawerOpen(false);
    setDrawerWidth(DEFAULT_WIDTH);
    setInsertData(new Map());
  }, [chatId]);

  useEffect(() => {
    if(!enabled || !openViewId) {
      if (!enabled) {
        setSelectionMode(false);
        setOpenViewId(null);
      }

      setDrawerOpen(false);
      setInsertData(new Map());
    }
  }, [enabled, openViewId]);

  const handleOpenSelectionMode = useCallback(() => {
    if (!enabled) return;
    setSelectionMode(true);
  }, [enabled]);

  const handleCloseSelectionMode = useCallback(() => {
    setSelectionMode(false);
  }, []);

  const handleOpenView = useCallback((viewId: string, data?: EditorData) => {
    if (!enabled) return;
    setDrawerOpen(true);
    setOpenViewId(viewId);

    if (data) {
      setInsertData((prev) => {
        const newMap = new Map(prev);

        newMap.set(viewId, data);
        return newMap;
      });
    }
  }, [enabled]);

  const handleCloseView = useCallback(() => {
    setOpenViewId(null);
  }, []);

  const getInsertData = useCallback((viewId: string) => {
    return insertData.get(viewId);
  }, [insertData]);

  const clearInsertData = useCallback((viewId: string) => {
    setInsertData((prev) => {
      const newMap = new Map(prev);

      newMap.delete(viewId);
      return newMap;
    });
  }, []);

  const handleSetDrawerOpen = useCallback((open: boolean) => {
    if (!enabled && open) return;
    setDrawerOpen(open);
  }, [enabled]);

  const contextValue = useMemo(() => ({
    chatId,
    openViewId,
    onOpenView: handleOpenView,
    onCloseView: handleCloseView,
    selectionMode,
    onOpenSelectionMode: handleOpenSelectionMode,
    onCloseSelectionMode: handleCloseSelectionMode,
    drawerWidth,
    onSetDrawerWidth: setDrawerWidth,
    getInsertData,
    clearInsertData,
    drawerOpen,
    setDrawerOpen: handleSetDrawerOpen,
    enabled,
  }), [
    chatId,
    openViewId,
    handleOpenView,
    handleCloseView,
    selectionMode,
    handleOpenSelectionMode,
    handleCloseSelectionMode,
    drawerWidth,
    getInsertData,
    clearInsertData,
    drawerOpen,
    handleSetDrawerOpen,
    enabled,
  ]);

  return (
    <AIChatContext.Provider value={contextValue}>
      {children}
      {enabled && <AIChatDrawer />}
    </AIChatContext.Provider>
  );
}
