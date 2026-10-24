import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDoc } from '@/application/types';
import type {
  DashboardContextValue,
  DashboardFiltersContextValue,
  DashboardLayoutContextValue,
  DashboardPrivateSummary,
  DashboardSourcesContextValue,
} from '@/components/database/dashboard/DashboardContext';

import { createSourceDoc, option } from './source-doc.fixture';

/**
 * The dashboard contexts of the global filter component tests, served from
 * one object (each test file mocks `DashboardContext` with it).
 */
export type MockDashboard = DashboardContextValue &
  DashboardLayoutContextValue &
  DashboardFiltersContextValue &
  DashboardSourcesContextValue & { summary: DashboardPrivateSummary };

export const todo = option('o-todo', 'Todo');
export const done = option('o-done', 'Done');

/** Projects (6 filterable properties), Tasks (2) and Notes (1). */
export function createTestDocs(): Record<string, YDoc> {
  return {
    'db-projects': createSourceDoc('db-projects', [
      { id: 'p-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
      { id: 'p-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
      { id: 'p-estimate', name: 'Estimate', type: FieldType.Number },
      { id: 'p-due', name: 'Due', type: FieldType.DateTime },
      { id: 'p-urgent', name: 'Urgent', type: FieldType.Checkbox },
      { id: 'p-region', name: 'Region', type: FieldType.SingleSelect, options: [option('p-eu', 'Europe')] },
    ]),
    'db-tasks': createSourceDoc('db-tasks', [
      { id: 't-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
      { id: 't-stage', name: 'Stage', type: FieldType.SingleSelect, options: [todo, done] },
    ]),
    'db-notes': createSourceDoc('db-notes', [{ id: 'n-name', name: 'Name', type: FieldType.RichText, isPrimary: true }]),
  };
}

export function rowsOf(...databaseIds: string[]): DashboardRow[] {
  return [
    {
      id: 'r:1',
      height: 360,
      widgets: databaseIds.map((databaseId, index) => ({
        id: `w:${index}`,
        viewId: `v:${databaseId}`,
        databaseId,
        width: 12 / databaseIds.length,
      })),
    },
  ];
}

export function createTestContext(overrides: Partial<MockDashboard> = {}): MockDashboard {
  const globalFilters: DashboardGlobalFilter[] = overrides.globalFilters ?? [];

  return {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db-projects',
    hostViewIds: [],
    rows: rowsOf('db-projects', 'db-tasks', 'db-notes'),
    showWidgetTitles: true,
    showIconsInHeading: false,
    globalFilters,
    effectiveGlobalFilters: globalFilters,
    privateGlobalValues: {},
    dirtyGlobalFilterIds: new Set(),
    setPrivateGlobalValue: jest.fn(),
    saveForEveryone: jest.fn(() => null),
    resetPrivateChanges: jest.fn(),
    getWidgetPrivateParts: jest.fn(),
    getViewOverlay: jest.fn(),
    setViewOverlayWritable: jest.fn(),
    resetViewOverlays: jest.fn(),
    commitViewOverlays: jest.fn(),
    canEdit: true,
    isEditing: true,
    setEditing: jest.fn(),
    mobileContext: false,
    canEnterEdit: true,
    pinEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
    sourceDocs: createTestDocs(),
    registerSourceDoc: jest.fn(),
    sourceNames: { 'db-projects': 'Projects', 'db-tasks': 'Tasks', 'db-notes': 'Notes' },
    registerSourceName: jest.fn(),
    summary: { hasChanges: false, canSave: false, dirtyGlobalCount: 0, dirtyWidgetCount: 0, savableWidgetCount: 0 },
    ...overrides,
  };
}

/** Radix menus open on a primary-button pointerdown, which jsdom cannot build. */
export function installPointerEvents() {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
}

export const MOCK_TRANSLATE = (key: string, options?: Record<string, unknown>) => {
  const count = options?.count;
  const template =
    (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
    options?.defaultValue ??
    key;

  return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};
