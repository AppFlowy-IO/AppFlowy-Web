import { createContext, useContext } from 'react';

import type { CalendarDraft } from '../draft/useCalendarDraft';

interface CalendarDraftContextValue {
  draft: CalendarDraft | null;
  finishDraft: (force?: boolean) => Promise<string | null>;
  discardDraft: () => void;
}

export const CalendarDraftContext = createContext<CalendarDraftContextValue | null>(null);

export const useCalendarDraftContext = () => useContext(CalendarDraftContext);
