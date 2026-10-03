import {
  BindViewSync,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  LoadView,
  LoadViewMeta,
  UpdatePagePayload,
  ViewLayout,
} from '@/application/types';

import { createLinkedDatabaseDashboardView, duplicateLinkedDatabaseDashboardView } from './dashboard-page';
import { createLinkedDatabaseFeedView } from './feed-layout';
import { createLinkedDatabaseGalleryView } from './gallery-layout';
import { createLinkedDatabaseListView } from './list-layout';

/**
 * A linked view of an existing database, as a document block shows it: the
 * `/linked ...` slash commands and a duplicated linked database block. One
 * table of per-layout creators, so a new layout is added in one place.
 */

export interface CreateLinkedDatabaseViewParams {
  /** The view the request is made for (the document that holds the block). */
  requestViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  /**
   * The view the new one is modelled on: the view picked for a new linked
   * block, or the view of the block being duplicated. A List, Gallery or Feed
   * starts from its configuration.
   */
  sourceViewId: string;
  /**
   * `true` when a block is being duplicated. Only a Dashboard tells the two
   * apart: a duplicate keeps the source's widgets (with its own copies of the
   * views they own), a new linked dashboard starts empty.
   */
  duplicate: boolean;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  loadView?: LoadView;
  loadViewMeta?: LoadViewMeta;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  deletePage?: (viewId: string) => Promise<void>;
  bindViewSync?: BindViewSync;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

export interface LinkedDatabaseViewResult {
  response: CreateDatabaseViewResponse;
  /**
   * Whether the caller still has to apply `response.database_update` to the
   * database doc. A layout with its own creator applies it itself.
   */
  databaseUpdatePending: boolean;
}

type LinkedDatabaseViewCreator = (params: CreateLinkedDatabaseViewParams) => Promise<CreateDatabaseViewResponse>;

async function createLinkedDashboardView(params: CreateLinkedDatabaseViewParams) {
  if (!params.duplicate) return createLinkedDatabaseDashboardView(params);
  const { deletePage, loadView, loadViewMeta, updatePage } = params;

  // A duplicate is all or nothing, so refuse before the server creates anything.
  if (!deletePage || !loadView || !loadViewMeta || !updatePage) {
    throw new Error('The linked dashboard could not be duplicated right now');
  }

  return duplicateLinkedDatabaseDashboardView({ ...params, deletePage, loadView, loadViewMeta, updatePage });
}

/** The layouts whose linked view needs more than the server's create call. */
const LINKED_DATABASE_VIEW_CREATORS: Partial<Record<ViewLayout, LinkedDatabaseViewCreator>> = {
  [ViewLayout.List]: createLinkedDatabaseListView,
  [ViewLayout.Gallery]: createLinkedDatabaseGalleryView,
  [ViewLayout.Feed]: createLinkedDatabaseFeedView,
  [ViewLayout.Dashboard]: createLinkedDashboardView,
};

/** Create a linked view of `layout` for a document block. */
export async function createLinkedDatabaseViewForLayout(
  layout: ViewLayout,
  params: CreateLinkedDatabaseViewParams
): Promise<LinkedDatabaseViewResult> {
  const creator = LINKED_DATABASE_VIEW_CREATORS[layout];

  if (creator) return { response: await creator(params), databaseUpdatePending: false };
  const response = await params.createDatabaseView(params.requestViewId, { ...params.payload, layout });

  return { response, databaseUpdatePending: true };
}
