import { useCallback, useSyncExternalStore } from 'react';

import { DatabaseViewLayout } from '@/application/types';

import {
  AddWidgetFlowEffect,
  AddWidgetFlowEvent,
  AddWidgetFlowState,
  IDLE_ADD_WIDGET_FLOW,
  reduceAddWidgetFlow,
} from './add-widget-flow';

/** The add flow's state as an external store: consumers select the slice they render. */
export interface AddWidgetFlowHandle {
  getState: () => AddWidgetFlowState;
  subscribe: (listener: () => void) => () => void;
  dispatch: (event: AddWidgetFlowEvent) => void;
}

/** A reducer store whose effects run after each transition (`useAddWidgetFlow`). */
export function createAddWidgetFlowStore(runEffects: (effects: AddWidgetFlowEffect[]) => void): AddWidgetFlowHandle {
  let state: AddWidgetFlowState = IDLE_ADD_WIDGET_FLOW;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (event) => {
      const result = reduceAddWidgetFlow(state, event);

      if (result.state !== state) {
        state = result.state;
        listeners.forEach((listener) => listener());
      }

      if (result.effects.length > 0) runEffects(result.effects);
    },
  };
}

/** The slice of the add flow a component renders; re-renders only when that slice changes. */
export function useAddWidgetFlowState<T>(handle: AddWidgetFlowHandle, selector: (state: AddWidgetFlowState) => T): T {
  const getSnapshot = useCallback(() => selector(handle.getState()), [handle, selector]);

  return useSyncExternalStore(handle.subscribe, getSnapshot, getSnapshot);
}

/**
 * Where each widget box's dock anchor (a zero-size element at its top-right
 * corner) is: the picker, the New view panel and the Source panel open
 * beside it (WP06 §1.6). The pending slot and the widget that replaces it
 * register the same widget id.
 */
export interface DockAnchorStore {
  /**
   * A ref callback for the anchor of `widgetId`: it registers the element on
   * attach and drops it on detach unless another element took over meanwhile
   * (the widget replacing the pending slot attaches before the slot detaches).
   */
  anchorRef: (widgetId: string) => (element: HTMLElement | null) => void;
  get: (widgetId: string) => HTMLElement | null;
  subscribe: (listener: () => void) => () => void;
}

export function createDockAnchorStore(): DockAnchorStore {
  const anchors = new Map<string, HTMLElement>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    anchorRef: (widgetId) => {
      let attached: HTMLElement | null = null;

      return (element) => {
        if (element) {
          attached = element;
          if (anchors.get(widgetId) === element) return;
          anchors.set(widgetId, element);
          notify();
          return;
        }

        if (attached && anchors.get(widgetId) === attached) {
          anchors.delete(widgetId);
          notify();
        }

        attached = null;
      };
    },
    get: (widgetId) => anchors.get(widgetId) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A request to open one widget's settings host from outside the widget (Edit chart, the Source panel's back). */
export interface WidgetSettingsRequest {
  widgetId: string;
  /** Every request is new, even for the same widget. */
  seq: number;
}

/**
 * The dashboard's add-widget surface (WP06): the flow, the docks and the
 * requests the docked panels send to widgets. Stable for the dashboard's
 * lifetime.
 */
export interface DashboardAddWidgetApi {
  flow: AddWidgetFlowHandle;
  dockAnchors: DockAnchorStore;
  /** Warm the plan check and the picker's code ahead of a click (hover or focus of a "+"). */
  preload: () => void;
  /** "Other data sources › New view in {database}" (`anchorViewId`: a regular view of that database). */
  createInDatabase: (databaseId: string, anchorViewId: string, layout: DatabaseViewLayout) => void;
  /** The last settings request; widgets open their settings host when it names them. */
  settingsRequest: {
    get: () => WidgetSettingsRequest | null;
    subscribe: (listener: () => void) => () => void;
  };
  requestWidgetSettings: (widgetId: string) => void;
  /** Settings › Source: the Source panel (replace mode) docked to the widget. */
  openSourcePanel: (widgetId: string) => void;
}

/** An add-widget surface that does nothing: for dashboards without an add flow (published pages, tests). */
export function createInertAddWidgetApi(): DashboardAddWidgetApi {
  const noSubscription = () => () => undefined;

  return {
    flow: { getState: () => IDLE_ADD_WIDGET_FLOW, subscribe: noSubscription, dispatch: () => undefined },
    dockAnchors: createDockAnchorStore(),
    preload: () => undefined,
    createInDatabase: () => undefined,
    settingsRequest: { get: () => null, subscribe: noSubscription },
    requestWidgetSettings: () => undefined,
    openSourcePanel: () => undefined,
  };
}

/** A settings request store with its writer. */
export function createWidgetSettingsRequests() {
  let current: WidgetSettingsRequest | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: (widgetId: string) => {
      seq += 1;
      current = { widgetId, seq };
      listeners.forEach((listener) => listener());
    },
  };
}
