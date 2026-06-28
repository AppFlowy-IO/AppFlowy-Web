import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

import { useDatabaseContext, useRow } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { assertDocExists } from '@/application/slate-yjs/utils/yjs';
import { FieldId, RowId, YDatabaseCells, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

export type DatabaseHistoryPolicy = 'capture' | 'skip';
export type DatabaseRowHistoryPolicy = DatabaseHistoryPolicy;

export type DatabaseHistoryAction = {
  type: string;
  rowId?: RowId;
  fieldId?: FieldId;
  fieldType?: FieldType | number;
  policy?: DatabaseHistoryPolicy;
};
export type DatabaseRowHistoryAction = DatabaseHistoryAction;

export class DatabaseHistoryOrigin {
  constructor(public readonly action: DatabaseHistoryAction) {}
}

export class DatabaseNoHistoryOrigin {
  constructor(public readonly action: DatabaseHistoryAction) {}
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
  private stackItemAddedSubscribers = new Set<(event: StackItemAddedEvent, source: DatabaseHistorySourceController) => void>();

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

  subscribeStackItemAdded(
    subscriber: (event: StackItemAddedEvent, source: DatabaseHistorySourceController) => void
  ) {
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

export class DatabaseHistoryManager {
  private databaseSource: DatabaseHistorySourceController | null = null;
  private rowSources = new WeakMap<YDoc, DatabaseHistorySourceController>();
  private sourceUnsubscribers = new WeakMap<DatabaseHistorySourceController, () => void>();
  private sourceSubscribers = new WeakMap<DatabaseHistorySourceController, () => void>();
  private undoStack: DatabaseHistoryStackEntry[] = [];
  private redoStack: DatabaseHistoryStackEntry[] = [];
  private subscribers = new Set<HistorySubscriber>();
  private replaying: 'undo' | 'redo' | null = null;
  private replayedStackItem: StackItem | null = null;

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
    this.undoStack = [];
    this.redoStack = [];
    this.getSources().forEach((source) => source.clear());
    this.notify();
  }

  undo() {
    this.pruneStacks();

    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop();

      if (!entry || !this.isTopUndoEntry(entry)) continue;

      this.replaying = 'undo';
      this.replayedStackItem = null;

      try {
        const stackItem = entry.source.undo();

        if (!stackItem) continue;

        this.redoStack.push({ source: entry.source, stackItem: this.replayedStackItem ?? stackItem });
        return stackItem;
      } finally {
        this.replaying = null;
        this.replayedStackItem = null;
        this.notify();
      }
    }

    this.notify();
    return null;
  }

  redo() {
    this.pruneStacks();

    while (this.redoStack.length > 0) {
      const entry = this.redoStack.pop();

      if (!entry || !this.isTopRedoEntry(entry)) continue;

      this.replaying = 'redo';
      this.replayedStackItem = null;

      try {
        const stackItem = entry.source.redo();

        if (!stackItem) continue;

        this.undoStack.push({ source: entry.source, stackItem: this.replayedStackItem ?? stackItem });
        return stackItem;
      } finally {
        this.replaying = null;
        this.replayedStackItem = null;
        this.notify();
      }
    }

    this.notify();
    return null;
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
        this.replayedStackItem = event.stackItem;
      }

      return;
    }

    if (event.type !== 'undo') return;

    this.undoStack.push({ source, stackItem: event.stackItem });
    this.redoStack = [];
    this.notify();
  };

  private getSources() {
    return [...new Set(this.undoStack.concat(this.redoStack).map((entry) => entry.source).concat(this.databaseSource ? [this.databaseSource] : []))];
  }

  private isTopUndoEntry(entry: DatabaseHistoryStackEntry) {
    const stack = entry.source.undoManager.undoStack;

    return stack.length > 0 && stack[stack.length - 1] === entry.stackItem;
  }

  private isTopRedoEntry(entry: DatabaseHistoryStackEntry) {
    const stack = entry.source.undoManager.redoStack;

    return stack.length > 0 && stack[stack.length - 1] === entry.stackItem;
  }

  private pruneStacks() {
    while (this.undoStack.length > 0 && !this.isTopUndoEntry(this.undoStack[this.undoStack.length - 1])) {
      this.undoStack.pop();
    }

    while (this.redoStack.length > 0 && !this.isTopRedoEntry(this.redoStack[this.redoStack.length - 1])) {
      this.redoStack.pop();
    }
  }

  private notify = () => {
    this.subscribers.forEach((subscriber) => subscriber());
  };
}

const rowHistoryControllers = new WeakMap<YDoc, DatabaseHistorySourceController>();
const databaseHistoryManagers = new WeakMap<YDoc, DatabaseHistoryManager>();
const rowDocManagers = new WeakMap<YDoc, Set<DatabaseHistoryManager>>();

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

function getDatabaseRowCells(rowDoc: YDoc): YDatabaseCells | null {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const row = rowSharedRoot.get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);

  return cells ?? null;
}

export function getDatabaseHistoryPolicy(action: DatabaseHistoryAction): DatabaseHistoryPolicy {
  if (action.type.startsWith('relation.') || Number(action.fieldType) === FieldType.Relation) {
    return 'skip';
  }

  return action.policy ?? 'capture';
}

export const getDatabaseRowHistoryPolicy = getDatabaseHistoryPolicy;

export function createDatabaseHistoryOrigin(action: DatabaseHistoryAction) {
  return getDatabaseHistoryPolicy(action) === 'capture'
    ? new DatabaseHistoryOrigin(action)
    : new DatabaseNoHistoryOrigin(action);
}

export function createDatabaseRowHistoryOrigin(action: DatabaseRowHistoryAction) {
  return getDatabaseHistoryPolicy(action) === 'capture'
    ? new DatabaseRowHistoryOrigin(action)
    : new DatabaseRowNoHistoryOrigin(action);
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

  const cells = getDatabaseRowCells(rowDoc);

  if (!cells) return null;

  const controller = new DatabaseHistorySourceController('row', rowDoc, cells, rowId);

  rowHistoryControllers.set(rowDoc, controller);
  attachRowControllerToManagers(rowDoc, controller);
  return controller;
}

export function runDatabaseAction(databaseDoc: YDoc, action: DatabaseHistoryAction, mutate: () => void) {
  if (getDatabaseHistoryPolicy(action) === 'capture') {
    getOrCreateDatabaseHistoryManager(databaseDoc);
  }

  databaseDoc.transact(mutate, createDatabaseHistoryOrigin(action));
}

export function runDatabaseRowAction(rowDoc: YDoc, action: DatabaseRowHistoryAction, mutate: () => void) {
  if (getDatabaseHistoryPolicy(action) === 'capture') {
    getOrCreateDatabaseRowHistoryController(rowDoc, action.rowId);
  }

  rowDoc.transact(mutate, createDatabaseRowHistoryOrigin(action));
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
