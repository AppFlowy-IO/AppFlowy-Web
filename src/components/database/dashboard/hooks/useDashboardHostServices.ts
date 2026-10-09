import { useContext, useMemo, useRef } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';

import { DashboardHostServices } from '../DashboardUiContext';

type ServiceFunctionKey = {
  [K in keyof DashboardHostServices]-?: NonNullable<DashboardHostServices[K]> extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof DashboardHostServices];

type ServiceFunctions = Pick<DashboardHostServices, ServiceFunctionKey>;

const FUNCTION_KEYS = [
  'addPage',
  'bindViewSync',
  'checkIfRowDocumentExists',
  'createDatabaseView',
  'createRow',
  'createRowDocument',
  'deletePage',
  'duplicatePage',
  'duplicateRowDocument',
  'generateAISummaryForRow',
  'generateAITranslateForRow',
  'getSubscriptions',
  'getViewIdFromDatabaseId',
  'loadDatabaseRelations',
  'loadRowDocument',
  'loadView',
  'loadViewMeta',
  'loadViews',
  'navigateToView',
  'openPageModal',
  'scheduleDeferredCleanup',
  'searchMentions',
  'updatePage',
  'uploadFile',
] as const satisfies readonly ServiceFunctionKey[];

// Compile-time check: a function-typed service added to `DashboardHostServices`
// must be listed above, or widgets would silently get `undefined` for it.
type MissingServiceFunctionKey = Exclude<ServiceFunctionKey, (typeof FUNCTION_KEYS)[number]>;
const EVERY_SERVICE_FUNCTION_LISTED: [MissingServiceFunctionKey] extends [never] ? true : never = true;

void EVERY_SERVICE_FUNCTION_LISTED;

type AnyFunction = (...args: unknown[]) => unknown;

/** What the services are read from: the host database's context, and the app's operations where there are any. */
interface ServiceSources {
  context: DatabaseContextState;
  app: Pick<DatabaseContextState, 'createRow' | 'getSubscriptions'> | null;
}

/**
 * The current service behind `key`. Row creation and the plan lookup are the
 * app's own when the app provides them: the host context's `createRow` is the
 * host database's wrapper for its own rows.
 */
function resolveService({ context, app }: ServiceSources, key: ServiceFunctionKey) {
  if (key === 'createRow') return app?.createRow ?? context.createRow;
  if (key === 'getSubscriptions') return app?.getSubscriptions ?? context.getSubscriptions;
  return context[key];
}

/**
 * One stable wrapper per defined service. A wrapper calls whatever the host
 * currently provides, so a service that is recreated (the app rebuilds
 * `loadViewMeta` and `navigateToView` whenever the trash list or the
 * database relations change) never changes the widgets' props.
 */
function bindLatest(latest: { current: ServiceSources }, definedKeys: string): ServiceFunctions {
  const defined = new Set(definedKeys.split(','));
  const bound: Partial<Record<ServiceFunctionKey, AnyFunction>> = {};

  FUNCTION_KEYS.forEach((key) => {
    if (!defined.has(key)) return;
    bound[key] = (...args: unknown[]) => (resolveService(latest.current, key) as unknown as AnyFunction)(...args);
  });

  return bound as unknown as ServiceFunctions;
}

/**
 * The host database's services for `DashboardHostContext`: one object that
 * keeps its identity while the host database, its permissions and the set of
 * available services are unchanged, so widgets never re-render for host
 * row-map, loading-state or service-identity changes.
 */
export function useDashboardHostServices(): DashboardHostServices {
  const context = useDatabaseContext();
  // Absent on a published page. The app rebuilds it with the trash list;
  // read here, through the wrappers, that renders the dashboard root once
  // instead of every widget.
  const app = useContext(AppOperationsContext);
  const sources: ServiceSources = { context, app };
  const latestRef = useRef(sources);

  latestRef.current = sources;

  const { databaseDoc, canComment, canShare, canWrite, eventEmitter, readOnly, variant, workspaceId } = context;
  // A service appears or disappears only when the host page changes.
  const definedKeys = FUNCTION_KEYS.filter((key) => typeof resolveService(sources, key) === 'function').join(',');
  const functions = useMemo(() => bindLatest(latestRef, definedKeys), [definedKeys]);

  return useMemo<DashboardHostServices>(
    () => ({
      ...functions,
      databaseDoc,
      canComment,
      canShare,
      canWrite,
      eventEmitter,
      readOnly,
      variant,
      workspaceId,
    }),
    [functions, databaseDoc, canComment, canShare, canWrite, eventEmitter, readOnly, variant, workspaceId]
  );
}
