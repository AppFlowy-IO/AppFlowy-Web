import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

import { useDatabaseContext, useRow } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { assertDocExists } from '@/application/slate-yjs/utils/yjs';
import { FieldId, RowId, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

export type DatabaseHistoryPolicy = 'capture' | 'skip';
export type DatabaseRowHistoryPolicy = DatabaseHistoryPolicy;

export type DatabaseHistoryAction = {
  type: string;
  rowId?: RowId;
  fieldId?: FieldId;
  fieldType?: FieldType | number;
  policy?: DatabaseHistoryPolicy;
  historyGroup?: object;
};
export type DatabaseRowHistoryAction = DatabaseHistoryAction;

type DatabaseHistoryGroup = object;

export class DatabaseHistoryOrigin {
  constructor(public readonly action: DatabaseHistoryAction, readonly group: DatabaseHistoryGroup | null = null) {}
}

export class DatabaseNoHistoryOrigin {
  constructor(public readonly action: DatabaseHistoryAction, readonly group: DatabaseHistoryGroup | null = null) {}
}

export class DatabaseRowHistoryOrigin extends DatabaseHistoryOrigin {}
export class DatabaseRowNoHistoryOrigin extends DatabaseNoHistoryOrigin {}

type HistorySubscriber = () => void;

type StackItem = Y.UndoManager['undoStack'][number];

type StackItemAddedEvent = {
  stackItem: StackItem;
  origin?: unknown;
  type: 'undo' | 'redo';
};

type HistorySourceKind = 'database' | 'row';

type DatabaseHistorySourceSnapshot = {
  canRedo: boolean;
  canUndo: boolean;
};

class DatabaseHistorySourceController {
  readonly undoManager: Y.UndoManager;

  private subscribers = new Set<HistorySubscriber>();
  private stackItemAddedSubscribers = new Set<
    (event: StackItemAddedEvent, source: DatabaseHistorySourceController) => void
  >();

  constructor(
    readonly kind: HistorySourceKind,
    readonly doc: YDoc,
    scope: Y.AbstractType<Y.YMapEvent<unknown>>,
    readonly rowId?: RowId
  ) {
    this.undoManager = new Y.UndoManager(scope, {
      trackedOrigins: new Set([DatabaseHistoryOrigin, DatabaseRowHistoryOrigin]),
      captureTimeout: 0,
    });

    this.undoManager.on('stack-item-added', this.handleStackItemAdded);
    this.undoManager.on('stack-item-popped', this.notify);
  }

  canUndo() {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo() {
    return this.undoManager.redoStack.length > 0;
  }

  clear() {
    this.undoManager.clear();
    this.notify();
  }

  clearRedo() {
    if (this.undoManager.redoStack.length === 0) return;

    // This Yjs version can only clear both stacks. Hide the undo stack while
    // clearing so redo items release their keep references without losing undo.
    const undoStack = this.undoManager.undoStack;

    this.undoManager.undoStack = [];

    try {
      this.undoManager.clear();
    } finally {
      this.undoManager.undoStack = undoStack;
    }

    this.notify();
  }

  undo() {
    const result = this.undoManager.undo();

    this.notify();
    return result;
  }

  redo() {
    const result = this.undoManager.redo();

    this.notify();
    return result;
  }

  replayStackItem(type: 'undo' | 'redo', stackItem: StackItem) {
    const stackKey = type === 'undo' ? 'undoStack' : 'redoStack';
    const sourceStack = this.undoManager[stackKey];
    const stackItemIndex = sourceStack.lastIndexOf(stackItem);

    if (stackItemIndex < 0) return null;

    sourceStack.splice(stackItemIndex, 1);
    const isolatedStack = [stackItem];

    this.undoManager[stackKey] = isolatedStack;

    try {
      return type === 'undo' ? this.undoManager.undo() : this.undoManager.redo();
    } finally {
      // Restore the source stack without the selected item. If replay threw
      // before consuming it, put it back at its original position.
      this.undoManager[stackKey] = sourceStack;

      if (isolatedStack.includes(stackItem)) {
        sourceStack.splice(stackItemIndex, 0, stackItem);
      }

      this.notify();
    }
  }

  snapshot(): DatabaseHistorySourceSnapshot {
    return {
      canRedo: this.canRedo(),
      canUndo: this.canUndo(),
    };
  }

  subscribe(subscriber: HistorySubscriber) {
    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  subscribeStackItemAdded(subscriber: (event: StackItemAddedEvent, source: DatabaseHistorySourceController) => void) {
    this.stackItemAddedSubscribers.add(subscriber);

    return () => {
      this.stackItemAddedSubscribers.delete(subscriber);
    };
  }

  private handleStackItemAdded = (event: StackItemAddedEvent) => {
    this.stackItemAddedSubscribers.forEach((subscriber) => subscriber(event, this));
    this.notify();
  };

  private notify = () => {
    this.subscribers.forEach((subscriber) => subscriber());
  };
}

type DatabaseHistoryStackEntry = {
  source: DatabaseHistorySourceController;
  stackItem: StackItem;
};

type DatabaseHistoryStackGroup = {
  group: DatabaseHistoryGroup;
  entries: DatabaseHistoryStackEntry[];
};

export class DatabaseHistoryManager {
  private databaseSource: DatabaseHistorySourceController | null = null;
  private rowSources = new WeakMap<YDoc, DatabaseHistorySourceController>();
  private sourceUnsubscribers = new WeakMap<DatabaseHistorySourceController, () => void>();
  private sourceSubscribers = new WeakMap<DatabaseHistorySourceController, () => void>();
  private sources = new Set<DatabaseHistorySourceController>();
  private undoStack: DatabaseHistoryStackGroup[] = [];
  private redoStack: DatabaseHistoryStackGroup[] = [];
  private subscribers = new Set<HistorySubscriber>();
  private replaying: 'undo' | 'redo' | null = null;
  private replayedEntries: DatabaseHistoryStackEntry[] = [];

  constructor(readonly databaseDoc: YDoc) {
    this.registerDatabaseDoc(databaseDoc);
  }

  canUndo() {
    this.pruneStacks();
    return this.undoStack.length > 0;
  }

  canRedo() {
    this.pruneStacks();
    return this.redoStack.length > 0;
  }

  clear() {
    this.sources.forEach((source) => source.clear());
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  undo() {
    return this.replay('undo');
  }

  redo() {
    return this.replay('redo');
  }

  registerRowDoc(rowId: RowId, rowDoc: YDoc) {
    registerRowDocManager(rowDoc, this);

    const existing = this.rowSources.get(rowDoc);

    if (existing) return existing;

    const controller = getOrCreateDatabaseRowHistoryController(rowDoc, rowId);

    if (!controller) return null;

    this.attachSource(controller);
    this.rowSources.set(rowDoc, controller);
    return controller;
  }

  subscribe(subscriber: HistorySubscriber) {
    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private registerDatabaseDoc(databaseDoc: YDoc) {
    const scope = getDatabaseHistoryScope(databaseDoc);

    if (!scope) return;

    this.databaseSource = new DatabaseHistorySourceController('database', databaseDoc, scope);
    this.attachSource(this.databaseSource);
  }

  attachRowController(rowDoc: YDoc, controller: DatabaseHistorySourceController) {
    if (this.rowSources.get(rowDoc) === controller) return;

    this.rowSources.set(rowDoc, controller);
    this.attachSource(controller);
  }

  private attachSource(source: DatabaseHistorySourceController) {
    this.sources.add(source);

    if (!this.sourceUnsubscribers.has(source)) {
      this.sourceUnsubscribers.set(source, source.subscribeStackItemAdded(this.handleStackItemAdded));
    }

    if (!this.sourceSubscribers.has(source)) {
      this.sourceSubscribers.set(source, source.subscribe(this.notify));
    }
  }

  private handleStackItemAdded = (event: StackItemAddedEvent, source: DatabaseHistorySourceController) => {
    if (this.replaying) {
      if ((this.replaying === 'undo' && event.type === 'redo') || (this.replaying === 'redo' && event.type === 'undo')) {
        this.replayedEntries.push({ source, stackItem: event.stackItem });
      }

      return;
    }

    if (event.type !== 'undo') return;

    const group =
      event.origin instanceof DatabaseHistoryOrigin && event.origin.group ? event.origin.group : Object.freeze({});
    const latestGroup = this.undoStack[this.undoStack.length - 1];
    const entry = { source, stackItem: event.stackItem };

    if (latestGroup?.group === group) {
      latestGroup.entries.push(entry);
    } else {
      this.undoStack.push({ group, entries: [entry] });
    }

    this.clearRedoHistory(source);
    this.notify();
  };

  private pruneStacks() {
    while (this.undoStack.length > 0 && !this.hasAvailableEntry(this.undoStack[this.undoStack.length - 1], 'undo')) {
      this.undoStack.pop();
    }

    while (this.redoStack.length > 0 && !this.hasAvailableEntry(this.redoStack[this.redoStack.length - 1], 'redo')) {
      this.redoStack.pop();
    }
  }

  private clearRedoHistory(sourceWithAlreadyClearedRedo?: DatabaseHistorySourceController) {
    this.redoStack = [];
    this.sources.forEach((source) => {
      if (source !== sourceWithAlreadyClearedRedo) {
        source.clearRedo();
      }
    });
  }

  private hasAvailableEntry(group: DatabaseHistoryStackGroup, type: 'undo' | 'redo') {
    const stackKey = type === 'undo' ? 'undoStack' : 'redoStack';

    return group.entries.some((entry) => entry.source.undoManager[stackKey].includes(entry.stackItem));
  }

  private replay(type: 'undo' | 'redo') {
    this.pruneStacks();

    const sourceStack = type === 'undo' ? this.undoStack : this.redoStack;
    const targetStack = type === 'undo' ? this.redoStack : this.undoStack;

    while (sourceStack.length > 0) {
      const group = sourceStack.pop();

      if (!group) continue;

      this.replaying = type;
      this.replayedEntries = [];
      let result: StackItem | null = null;

      try {
        // Entries are recorded in mutation order. Replaying in reverse makes a
        // compound action atomic while respecting dependencies between docs.
        for (let index = group.entries.length - 1; index >= 0; index -= 1) {
          const entry = group.entries[index];
          const replayed = entry.source.replayStackItem(type, entry.stackItem);

          result = result ?? replayed;
        }
      } finally {
        this.replaying = null;

        if (this.replayedEntries.length > 0) {
          targetStack.push({ group: group.group, entries: this.replayedEntries });
        }

        this.replayedEntries = [];
        this.notify();
      }

      // A remote edit can make a selected item ineffective. Only that exact
      // item was consumed, so continue at the next global action instead of
      // allowing the source UndoManager to scan into older local history.
      if (result) return result;
    }

    this.notify();
    return null;
  }

  private notify = () => {
    this.subscribers.forEach((subscriber) => subscriber());
  };
}

const rowHistoryControllers = new WeakMap<YDoc, DatabaseHistorySourceController>();
const databaseHistoryManagers = new WeakMap<YDoc, DatabaseHistoryManager>();
const rowDocManagers = new WeakMap<YDoc, Set<DatabaseHistoryManager>>();
let activeDatabaseHistoryGroup: DatabaseHistoryGroup | null = null;

function registerRowDocManager(rowDoc: YDoc, manager: DatabaseHistoryManager) {
  let managers = rowDocManagers.get(rowDoc);

  if (!managers) {
    managers = new Set();
    rowDocManagers.set(rowDoc, managers);
  }

  managers.add(manager);
}

function attachRowControllerToManagers(rowDoc: YDoc, controller: DatabaseHistorySourceController) {
  rowDocManagers.get(rowDoc)?.forEach((manager) => {
    manager.attachRowController(rowDoc, controller);
  });
}

function getDatabaseHistoryScope(databaseDoc: YDoc): Y.AbstractType<Y.YMapEvent<unknown>> | null {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = sharedRoot.get(YjsEditorKey.database);

  return database ?? sharedRoot;
}

function getDatabaseRowHistoryScope(rowDoc: YDoc): YSharedRoot | null {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const row = rowSharedRoot.get(YjsEditorKey.database_row);

  return row ? rowSharedRoot : null;
}

export function getDatabaseHistoryPolicy(action: DatabaseHistoryAction): DatabaseHistoryPolicy {
  if (action.type.startsWith('relation.') || Number(action.fieldType) === FieldType.Relation) {
    return 'skip';
  }

  return action.policy ?? 'capture';
}

export const getDatabaseRowHistoryPolicy = getDatabaseHistoryPolicy;

export function createDatabaseHistoryGroup(): object {
  return Object.freeze({});
}

export function runDatabaseHistoryGroup<T>(mutate: () => T, historyGroup?: object): T {
  if (activeDatabaseHistoryGroup) return mutate();

  activeDatabaseHistoryGroup = historyGroup ?? createDatabaseHistoryGroup();

  try {
    return mutate();
  } finally {
    activeDatabaseHistoryGroup = null;
  }
}

export function createDatabaseHistoryOrigin(action: DatabaseHistoryAction) {
  const group = action.historyGroup ?? activeDatabaseHistoryGroup;

  return getDatabaseHistoryPolicy(action) === 'capture'
    ? new DatabaseHistoryOrigin(action, group)
    : new DatabaseNoHistoryOrigin(action, group);
}

export function createDatabaseRowHistoryOrigin(action: DatabaseRowHistoryAction) {
  const group = action.historyGroup ?? activeDatabaseHistoryGroup;

  return getDatabaseHistoryPolicy(action) === 'capture'
    ? new DatabaseRowHistoryOrigin(action, group)
    : new DatabaseRowNoHistoryOrigin(action, group);
}

export function getOrCreateDatabaseHistoryManager(databaseDoc: YDoc) {
  const existing = databaseHistoryManagers.get(databaseDoc);

  if (existing) return existing;

  const manager = new DatabaseHistoryManager(databaseDoc);

  databaseHistoryManagers.set(databaseDoc, manager);
  return manager;
}

export function getOrCreateDatabaseRowHistoryController(rowDoc: YDoc, rowId?: RowId) {
  const existing = rowHistoryControllers.get(rowDoc);

  if (existing) return existing;

  const scope = getDatabaseRowHistoryScope(rowDoc);

  if (!scope) return null;

  const controller = new DatabaseHistorySourceController('row', rowDoc, scope, rowId);

  rowHistoryControllers.set(rowDoc, controller);
  attachRowControllerToManagers(rowDoc, controller);
  return controller;
}

export function runDatabaseAction(databaseDoc: YDoc, action: DatabaseHistoryAction, mutate: () => void) {
  runDatabaseHistoryGroup(() => {
    if (getDatabaseHistoryPolicy(action) === 'capture') {
      getOrCreateDatabaseHistoryManager(databaseDoc);
    }

    databaseDoc.transact(mutate, createDatabaseHistoryOrigin(action));
  }, action.historyGroup);
}

export function runDatabaseRowAction(rowDoc: YDoc, action: DatabaseRowHistoryAction, mutate: () => void) {
  runDatabaseHistoryGroup(() => {
    if (getDatabaseHistoryPolicy(action) === 'capture') {
      getOrCreateDatabaseRowHistoryController(rowDoc, action.rowId);
    }

    rowDoc.transact(mutate, createDatabaseRowHistoryOrigin(action));
  }, action.historyGroup);
}

export function executeDatabaseOperations(
  sharedRoot: YSharedRoot,
  operations: (() => void)[],
  operationName: string,
  action: DatabaseHistoryAction = { type: `database.${operationName}` }
) {
  console.time(operationName);
  const doc = assertDocExists(sharedRoot);

  runDatabaseAction(doc, action, () => {
    operations.forEach((op) => op());
  });

  console.timeEnd(operationName);
}

export function useDatabaseHistory(rowId?: RowId) {
  const { databaseDoc, rowMap } = useDatabaseContext();
  const manager = useMemo(() => getOrCreateDatabaseHistoryManager(databaseDoc), [databaseDoc]);
  const rowSharedRoot = useRow(rowId ?? '');
  const rowDoc = rowId ? (rowSharedRoot?.doc as YDoc | undefined) ?? rowMap?.[rowId] : undefined;
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return manager.subscribe(() => {
      forceUpdate((value) => value + 1);
    });
  }, [manager]);

  useEffect(() => {
    Object.entries(rowMap ?? {}).forEach(([id, doc]) => {
      manager.registerRowDoc(id, doc);
    });
  }, [manager, rowMap]);

  useEffect(() => {
    if (!rowId || !rowDoc) return;

    manager.registerRowDoc(rowId, rowDoc);
  }, [manager, rowDoc, rowId]);

  const undo = useCallback(() => {
    manager.undo();
  }, [manager]);

  const redo = useCallback(() => {
    manager.redo();
  }, [manager]);

  const clear = useCallback(() => {
    manager.clear();
  }, [manager]);

  return {
    canRedo: manager.canRedo(),
    canUndo: manager.canUndo(),
    clear,
    redo,
    undo,
    manager,
  };
}

export function useDatabaseRowHistory(rowId?: RowId) {
  const { rowMap } = useDatabaseContext();
  const rowSharedRoot = useRow(rowId ?? '');
  const rowDoc = rowId ? (rowSharedRoot?.doc as YDoc | undefined) ?? rowMap?.[rowId] : undefined;
  const row = rowSharedRoot?.get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);
  const controller = useMemo(() => {
    if (!rowDoc || !cells) return null;

    return getOrCreateDatabaseRowHistoryController(rowDoc, rowId);
  }, [cells, rowDoc, rowId]);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!controller) return;

    return controller.subscribe(() => {
      forceUpdate((value) => value + 1);
    });
  }, [controller]);

  const undo = useCallback(() => {
    controller?.undo();
  }, [controller]);

  const redo = useCallback(() => {
    controller?.redo();
  }, [controller]);

  const clear = useCallback(() => {
    controller?.clear();
  }, [controller]);

  const runAction = useCallback(
    (action: DatabaseRowHistoryAction, mutate: () => void) => {
      if (!rowDoc) return false;

      runDatabaseRowAction(rowDoc, action, mutate);
      return true;
    },
    [rowDoc]
  );

  return {
    canRedo: controller?.canRedo() ?? false,
    canUndo: controller?.canUndo() ?? false,
    clear,
    redo,
    runAction,
    undo,
    undoManager: controller?.undoManager ?? null,
  };
}

export function useLatestDatabaseRowHistory() {
  return useDatabaseHistory();
}
