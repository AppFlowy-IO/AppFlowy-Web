import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { useBoardLayoutSettings, useGroupsSelector } from '@/application/database-yjs';
import { useMoveCardDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';

// --- Actions context (stable — callbacks only) ---

type BoardActionsContextType = {
  groupId: string;
  setSelectedCardIds: (ids: string[]) => void;
  setEditingCardId: (id: string | null) => void;
  setCreatingColumnId: (id: string | null) => void;
  createCard: (columnId: string, beforeCardId?: string) => Promise<string | null>;
  moveCard: ({
    rowId,
    beforeRowId,
    startColumnId,
    finishColumnId,
  }: {
    rowId: string;
    beforeRowId?: string;
    startColumnId: string;
    finishColumnId: string;
  }) => void;
};

const BoardActionsContext = createContext<BoardActionsContextType | undefined>(undefined);

// --- Selection context (volatile — state) ---

type BoardSelectionContextType = {
  selectedCardIds: string[];
  editingCardId: string | null;
  creatingColumnId: string | null;
};

const BoardSelectionContext = createContext<BoardSelectionContextType | undefined>(undefined);

// --- Hooks ---

/**
 * @deprecated Prefer `useBoardActions()` or `useBoardSelection()` for better rerender performance.
 * Returns a merged object that changes when either context changes.
 */
export function useBoardContext() {
  const actions = useContext(BoardActionsContext);
  const selection = useContext(BoardSelectionContext);

  if (!actions || !selection) {
    throw new Error('useBoardContext must be used within a BoardProvider');
  }

  return useMemo(() => ({ ...actions, ...selection }), [actions, selection]);
}

/** Stable callbacks only — will NOT rerender on selection / editing state changes. */
export function useBoardActions() {
  const actions = useContext(BoardActionsContext);

  if (!actions) {
    throw new Error('useBoardActions must be used within a BoardProvider');
  }

  return actions;
}

/** Volatile selection state only. */
export function useBoardSelection() {
  const selection = useContext(BoardSelectionContext);

  if (!selection) {
    throw new Error('useBoardSelection must be used within a BoardProvider');
  }

  return selection;
}

// --- Provider ---

export const BoardProvider = ({ children }: { children: React.ReactNode }) => {
  const groups = useGroupsSelector();
  const groupId = groups[0];
  const { fieldId } = useBoardLayoutSettings();
  const onMoveCard = useMoveCardDispatch();

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [creatingColumnId, setCreatingColumnId] = useState<string | null>(null);
  const onNewCard = useNewRowDispatch();

  const createCard = useCallback(
    async (columnId: string, beforeCardId?: string) => {
      if (!fieldId) return null;
      const cellsData = {
        [fieldId]: columnId,
      };

      const beforeRowId = beforeCardId ? beforeCardId.split('/')[1] : undefined;
      const cardId = await onNewCard({cellsData, beforeRowId});

      if (!cardId) return null;
      setSelectedCardIds([]);

      setEditingCardId(`${columnId}/${cardId}`);
      return cardId;
    },
    [fieldId, onNewCard]
  );

  const moveCard = useCallback(
    ({
      rowId,
      beforeRowId,
      startColumnId,
      finishColumnId,
    }: {
      rowId: string;
      beforeRowId?: string;
      startColumnId: string;
      finishColumnId: string;
    }) => {
      if (!fieldId) return;
      onMoveCard({ rowId, beforeRowId, fieldId, startColumnId, finishColumnId });
      setSelectedCardIds([`${finishColumnId}/${rowId}`]);
    },
    [fieldId, onMoveCard]
  );

  const actionsValue = useMemo(
    () => ({
      groupId,
      setSelectedCardIds,
      setEditingCardId,
      setCreatingColumnId,
      createCard,
      moveCard,
    }),
    [groupId, createCard, moveCard]
  );

  const selectionValue = useMemo(
    () => ({
      selectedCardIds,
      editingCardId,
      creatingColumnId,
    }),
    [selectedCardIds, editingCardId, creatingColumnId]
  );

  return (
    <BoardActionsContext.Provider value={actionsValue}>
      <BoardSelectionContext.Provider value={selectionValue}>
        {children}
      </BoardSelectionContext.Provider>
    </BoardActionsContext.Provider>
  );
};
