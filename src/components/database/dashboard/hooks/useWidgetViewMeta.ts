import { EventEmitter } from 'events';
import { useEffect, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { View, ViewIcon } from '@/application/types';
import { useViewMeta } from '@/components/editor/components/blocks/database/hooks/useViewMeta';

import { useDashboardHost } from '../DashboardUiContext';

interface MetaOverride {
  name: string;
  icon: ViewIcon | null;
}

type ViewListener = (view: View) => void;

interface EmitterSubscriptions {
  byViewId: Map<string, Set<ViewListener>>;
  detach: () => void;
}

// One pair of app-event listeners per emitter, however many widgets are
// mounted: the outline (reloaded on every sidebar expand and folder sync) is
// walked once per load, not once per widget.
const subscriptionsByEmitter = new WeakMap<EventEmitter, EmitterSubscriptions>();

function attach(emitter: EventEmitter): EmitterSubscriptions {
  const byViewId = new Map<string, Set<ViewListener>>();
  const notify = (view: View) => byViewId.get(view.view_id)?.forEach((listener) => listener(view));
  const handleViewChanged = (view: View) => notify(view);
  const handleOutlineLoaded = (outline: View[]) => {
    const stack = [...outline];

    while (stack.length > 0) {
      const view = stack.pop() as View;

      if (byViewId.has(view.view_id)) notify(view);
      if (view.children?.length) stack.push(...view.children);
    }
  };

  emitter.on(APP_EVENTS.VIEW_META_CHANGED, handleViewChanged);
  emitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);

  return {
    byViewId,
    detach: () => {
      emitter.off(APP_EVENTS.VIEW_META_CHANGED, handleViewChanged);
      emitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    },
  };
}

/** Follow renames and icon changes of `viewId`; the emitter's listeners are shared by every subscriber. */
export function subscribeViewMeta(emitter: EventEmitter, viewId: string, listener: ViewListener): () => void {
  let subscriptions = subscriptionsByEmitter.get(emitter);

  if (!subscriptions) {
    subscriptions = attach(emitter);
    subscriptionsByEmitter.set(emitter, subscriptions);
  }

  const { byViewId } = subscriptions;
  let listeners = byViewId.get(viewId);

  if (!listeners) {
    listeners = new Set();
    byViewId.set(viewId, listeners);
  }

  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) byViewId.delete(viewId);
    if (byViewId.size === 0 && subscriptionsByEmitter.get(emitter) === subscriptions) {
      subscriptions?.detach();
      subscriptionsByEmitter.delete(emitter);
    }
  };
}

function sameIcon(a: ViewIcon | null, b: ViewIcon | null) {
  return a === b || (a !== null && b !== null && a.ty === b.ty && a.value === b.value);
}

/** Folder name / icon of the widget's view, following renames. */
export function useWidgetViewMeta(viewId: string) {
  const { loadViewMeta, eventEmitter } = useDashboardHost();
  const { viewMeta } = useViewMeta({ viewId, loadViewMeta, ignoreMetaErrors: true });
  const [override, setOverride] = useState<MetaOverride | null>(null);

  useEffect(() => {
    if (!eventEmitter) return;

    // Keep the current override unless the name or icon really changed.
    return subscribeViewMeta(eventEmitter, viewId, (view) => {
      const icon = view.icon ?? null;

      setOverride((current) =>
        current && current.name === view.name && sameIcon(current.icon, icon) ? current : { name: view.name, icon }
      );
    });
  }, [eventEmitter, viewId]);

  return {
    name: override?.name ?? viewMeta?.name ?? '',
    icon: override ? override.icon : viewMeta?.icon ?? null,
    layout: viewMeta?.layout,
  };
}
