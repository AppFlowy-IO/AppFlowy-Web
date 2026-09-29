import { useMemo, useRef } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import type { DatabaseContextState } from '@/application/database-yjs/context';

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

/**
 * One stable wrapper per defined service. A wrapper calls whatever the host
 * currently provides, so a service that is recreated (the app rebuilds
 * `loadViewMeta` and `navigateToView` whenever the trash list or the
 * database relations change) never changes the widgets' props.
 */
function bindLatest(latest: { current: DatabaseContextState }, definedKeys: string): ServiceFunctions {
  const defined = new Set(definedKeys.split(','));
  const bound: Partial<Record<ServiceFunctionKey, AnyFunction>> = {};

  FUNCTION_KEYS.forEach((key) => {
    if (!defined.has(key)) return;
    bound[key] = (...args: unknown[]) => (latest.current[key] as unknown as AnyFunction)(...args);
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
  const latestRef = useRef(context);

  latestRef.current = context;

  const { databaseDoc, canComment, canShare, canWrite, eventEmitter, readOnly, variant, workspaceId } = context;
  // A service appears or disappears only when the host page changes.
  const definedKeys = FUNCTION_KEYS.filter((key) => typeof context[key] === 'function').join(',');
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
