import AIChatDrawer from '@/components/ai-chat/AIChatDrawer';
import { useAppViewId } from '@/components/app/app.hooks';
import { EditorData } from '@appflowyinc/editor';
import React, { useCallback, useEffect, useState } from 'react';

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
} | undefined>(undefined);

export function useAIChatContext() {
  const context = React.useContext(AIChatContext);

  if(!context) {
    throw new Error('useAIChatContext must be used within a AIChatProvider');
  }

  return context;
}

export function AIChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const chatId = useAppViewId();
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
    if(!openViewId) {
      setDrawerOpen(false);
      setInsertData(new Map());
    }
  }, [openViewId]);

  const handleOpenSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const handleCloseSelectionMode = useCallback(() => {
    setSelectionMode(false);
  }, []);

  const handleOpenView = useCallback((viewId: string, insertData?: EditorData) => {
    setDrawerOpen(true);
    setOpenViewId(viewId);

    // ensure that the insert data is updated before the view id has been updated
    requestAnimationFrame(() => {
      if(insertData) {
        setInsertData(() => {
          const newMap = new Map();

          newMap.set(viewId, insertData);
          return newMap;
        });
      }
    });

  }, []);

  const handleCloseView = useCallback(() => {
    setOpenViewId(null);
  }, []);

  const getInsertData = useCallback((viewId: string) => {
    return insertData.get(viewId);
  }, [insertData]);

  const clearInsertData = useCallback((viewId: string) => {
    setInsertData((prev) => {
      prev.delete(viewId);
      return prev;
    });
  }, []);

  return (
    <AIChatContext.Provider
      value={{
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
        setDrawerOpen,
      }}
    >
      {children}
      <AIChatDrawer />
    </AIChatContext.Provider>
  );
}

