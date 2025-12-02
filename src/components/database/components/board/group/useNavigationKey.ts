import { useEffect, useRef } from 'react';

import { Log } from '@/utils/log';
import { useDatabaseContext } from '@/application/database-yjs';
import { useBoardContext } from '@/components/database/board/BoardProvider';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function useNavigationKey(
  element: HTMLElement | null,
  {
    onDelete,
    onEnter,
  }: {
    onDelete: (ids: string[]) => void;
    onEnter: (id: string) => void;
  }
) {
  const { isDocumentBlock } = useDatabaseContext();
  const {
    selectedCardIds,
    setSelectedCardIds,
    setEditingCardId,
    editingCardId,
    setCreatingColumnId,
    creatingColumnId,
    createCard,
    moveCard,
  } = useBoardContext();

  // Stable data to avoid re-registering event listener
  const stableSelectedCardId = useRef(selectedCardIds);
  const stableEditingCardId = useRef(editingCardId);
  const stableCreatingColumnId = useRef(creatingColumnId);
  // Record the last focused card ID for Shift multi-selection
  const lastFocusedCardIdRef = useRef<string | null>(null);
  // Current focused card ID
  const focusedIdRef = useRef<string | null>(null);

  useEffect(() => {
    stableSelectedCardId.current = selectedCardIds;
    if (selectedCardIds.length === 1) {
      focusedIdRef.current = selectedCardIds[0];
      lastFocusedCardIdRef.current = selectedCardIds[0];
    }
  }, [selectedCardIds]);

  useEffect(() => {
    stableEditingCardId.current = editingCardId;
  }, [editingCardId]);

  useEffect(() => {
    stableCreatingColumnId.current = creatingColumnId;
  }, [creatingColumnId]);

  useEffect(() => {
    if (!element || isDocumentBlock) return;

    const clearSelection = () => {
      if (stableSelectedCardId.current.length > 0) {
        stableSelectedCardId.current = [];
        setSelectedCardIds([]);
      }

      focusedIdRef.current = null;
      lastFocusedCardIdRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (stableEditingCardId.current || stableCreatingColumnId.current) {
        return;
      }

      const cards = Array.from(element.querySelectorAll('[data-card-id]'));

      if (cards.length === 0) return;

      const isUp = event.key === 'ArrowUp';
      const isDown = event.key === 'ArrowDown';
      const isShift = event.shiftKey;
      const isEsc = createHotkey(HOT_KEY_NAME.ESCAPE)(event);
      const isDelete = event.key === 'Delete' || event.key === 'Backspace';
      const isEnter = createHotkey(HOT_KEY_NAME.ENTER)(event);
      const isEnterEditing = event.key.toLowerCase() === 'e';
      const isCreating = event.key.toLowerCase() === 'n';
      const isCreateBefore = createHotkey(HOT_KEY_NAME.CREATE_CARD_BEFORE)(event);
      const isCreateAfter = createHotkey(HOT_KEY_NAME.CREATE_CARD_AFTER)(event);
      const moveCardPrevColumn = createHotkey(HOT_KEY_NAME.MOVE_CARD_PREV_COLUMN)(event);
      const moveCardNextColumn = createHotkey(HOT_KEY_NAME.MOVE_CARD_NEXT_COLUMN)(event);

      // Return if not arrow keys
      if (
        !isUp &&
        !isDown &&
        !isEsc &&
        !isDelete &&
        !isEnter &&
        !isEnterEditing &&
        !isCreating &&
        !isCreateBefore &&
        !isCreateAfter &&
        !moveCardPrevColumn &&
        !moveCardNextColumn
      )
        return;

      if (lastFocusedCardIdRef.current) {
        // Prevent keyboard event from causing page scroll
        event.preventDefault();

        if (isEsc) {
          Log.debug('esc');
          clearSelection();
          return;
        }

        if (isDelete) {
          onDelete(stableSelectedCardId.current);
          return;
        }

        if (isEnter) {
          onEnter(lastFocusedCardIdRef.current);
          clearSelection();
          return;
        }

        if (isEnterEditing) {
          setEditingCardId(lastFocusedCardIdRef.current);
          clearSelection();
          return;
        }

        if (isCreating) {
          const columnId = lastFocusedCardIdRef.current?.split('/')?.[0];

          if (columnId) {
            setCreatingColumnId(columnId);
            clearSelection();
          }

          return;
        }

        if (isCreateBefore) {
          const id = lastFocusedCardIdRef.current;
          const columnId = id.split('/')?.[0];

          if (columnId && id) {
            const column = element.querySelector(`[data-column-id="${columnId}"]`) as HTMLElement;
            const columnCards = column.querySelectorAll('[data-card-id]');
            const index = Array.from(columnCards)
              .map((card) => card.getAttribute('data-card-id'))
              .indexOf(id);

            const beforeCardId = index > 0 ? columnCards[index - 1].getAttribute('data-card-id') : undefined;

            void createCard(columnId, beforeCardId || undefined);
          }

          return;
        }

        if (isCreateAfter) {
          const id = lastFocusedCardIdRef.current;
          const columnId = id.split('/')?.[0];

          void createCard(columnId, id);

          return;
        }

        if (moveCardPrevColumn) {
          const id = lastFocusedCardIdRef.current;
          const columnId = id.split('/')?.[0];
          const columns = Array.from(element.querySelectorAll('[data-column-id]'));
          const columnIndex = columns.findIndex((column) => column.getAttribute('data-column-id') === columnId);
          const prevColumn = columns[columnIndex - 1];
          const prevColumnId = prevColumn?.getAttribute('data-column-id');

          if (prevColumnId) {
            const prevColumnCards = Array.from(prevColumn.querySelectorAll('[data-card-id]'));
            const lastCard = prevColumnCards[prevColumnCards.length - 1];
            const lastCardId = lastCard?.getAttribute('data-card-id');
            const beforeRowId = lastCardId ? lastCardId.split('/')?.[1] : undefined;

            const rowId = id.split('/')?.[1];

            clearSelection();
            moveCard({
              rowId,
              startColumnId: columnId,
              finishColumnId: prevColumnId,
              beforeRowId,
            });
          }

          return;
        }

        if (moveCardNextColumn) {
          const id = lastFocusedCardIdRef.current;
          const columnId = id.split('/')?.[0];
          const columns = Array.from(element.querySelectorAll('[data-column-id]'));
          const columnIndex = columns.findIndex((column) => column.getAttribute('data-column-id') === columnId);
          const nextColumn = columns[columnIndex + 1];
          const nextColumnId = nextColumn?.getAttribute('data-column-id');

          if (nextColumnId) {
            const nextColumnCards = Array.from(nextColumn.querySelectorAll('[data-card-id]'));
            const lastCard = nextColumnCards[nextColumnCards.length - 1];
            const lastCardId = lastCard?.getAttribute('data-card-id');
            const beforeRowId = lastCardId ? lastCardId.split('/')?.[1] : undefined;

            const rowId = id.split('/')?.[1];

            clearSelection();
            moveCard({
              rowId,
              startColumnId: columnId,
              finishColumnId: nextColumnId,
              beforeRowId,
            });
          }

          return;
        }
      }

      if (!isUp && !isDown) {
        return;
      }

      event.preventDefault();
      const target = event.target as HTMLElement;

      const contentEditable = target.getAttribute('contenteditable');

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || contentEditable === 'true') {
        target.blur();
      }

      // Get all card IDs
      const cardIds = cards.map((card) => card.getAttribute('data-card-id')) as string[];

      // Get the index of currently selected card
      let currentIndex = -1;

      const selectedCardIds = stableSelectedCardId.current;

      // If there's a focused card, use its index
      if (focusedIdRef.current) {
        currentIndex = cardIds.indexOf(focusedIdRef.current);
      }

      // Otherwise use the index of the first selected card
      else if (selectedCardIds.length > 0) {
        currentIndex = cardIds.indexOf(selectedCardIds[selectedCardIds.length - 1]);
      }

      // If no card is selected or focused, select the first one by default
      if (currentIndex === -1) {
        const firstCardId = cardIds[0];

        stableSelectedCardId.current = [firstCardId];
        setSelectedCardIds([firstCardId]);
        lastFocusedCardIdRef.current = firstCardId;
        focusedIdRef.current = firstCardId;

        // Ensure the first card is visible
        const firstCard = cards[0] as HTMLElement;

        if (firstCard) {
          firstCard.focus();
          firstCard.scrollIntoView({ block: 'nearest' });
        }

        return;
      }

      // Calculate new index
      let newIndex = currentIndex;

      if (isUp && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else if (isDown && currentIndex < cards.length - 1) {
        newIndex = currentIndex + 1;
      }

      // Return if index hasn't changed
      if (newIndex === currentIndex) return;

      const newCardId = cardIds[newIndex];

      // Handle selection logic
      if (isShift) {
        // Shift multi-selection logic
        handleShiftSelect(newCardId, cardIds);
      } else {
        // Single selection logic
        stableSelectedCardId.current = [newCardId];
        setSelectedCardIds([newCardId]);
        lastFocusedCardIdRef.current = newCardId;
      }

      // Update currently focused card
      focusedIdRef.current = newCardId;

      // Ensure the newly selected card is visible
      const newCard = cards[newIndex] as HTMLElement;

      if (newCard) {
        newCard.focus();
        newCard.scrollIntoView({ block: 'nearest' });
      }
    };

    // Function to handle Shift multi-selection
    const handleShiftSelect = (newCardId: string, cardIds: string[]) => {
      const selectedCardIds = stableSelectedCardId.current;

      // If there's no last focused card, use the first selected card
      if (!lastFocusedCardIdRef.current && selectedCardIds.length > 0) {
        lastFocusedCardIdRef.current = selectedCardIds[0];
      } else if (!lastFocusedCardIdRef.current) {
        // If still no reference point, use the current card
        lastFocusedCardIdRef.current = newCardId;
      }

      const lastFocusedIndex = cardIds.indexOf(lastFocusedCardIdRef.current);
      const newIndex = cardIds.indexOf(newCardId);

      if (lastFocusedIndex === -1 || newIndex === -1) return;

      // Determine the start and end of selection range
      const startIndex = Math.min(lastFocusedIndex, newIndex);
      const endIndex = Math.max(lastFocusedIndex, newIndex);

      // Get all card IDs within the range
      const rangeCardIds = cardIds.slice(startIndex, endIndex + 1);

      // Update selected cards
      stableSelectedCardId.current = rangeCardIds;
      setSelectedCardIds(rangeCardIds);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', clearSelection);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', clearSelection);
    };
  }, [element, setSelectedCardIds, onDelete, onEnter, setEditingCardId, setCreatingColumnId, createCard, moveCard, isDocumentBlock]);
}
