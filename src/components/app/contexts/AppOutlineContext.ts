import { createContext } from 'react';

import { DatabaseRelations, MentionablePerson, UIVariant, View } from '@/application/types';

// Outline / sidebar state — changes on folder mutations, not on page navigation
export interface AppOutlineContextType {
  outline?: View[];
  favoriteViews?: View[];
  recentViews?: View[];
  trashList?: View[];
  loadedViewIds?: Set<string>;
  loadViewChildren?: (viewId: string) => Promise<View[]>;
  loadViewChildrenBatch?: (viewIds: string[]) => Promise<View[]>;
  markViewChildrenStale?: (viewId: string) => void;
  loadFavoriteViews?: () => Promise<View[] | undefined>;
  loadRecentViews?: () => Promise<View[] | undefined>;
  loadTrash?: (workspaceId: string) => Promise<void>;
  loadViews?: (variant?: UIVariant) => Promise<View[] | undefined>;
  refreshOutline?: () => Promise<void>;
  loadDatabaseRelations?: () => Promise<DatabaseRelations | undefined>;
  getMentionUser?: (uuid: string) => Promise<MentionablePerson | undefined>;
  loadMentionableUsers?: () => Promise<MentionablePerson[]>;
}

export const AppOutlineContext = createContext<AppOutlineContextType | null>(null);
