import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';

import { TimelineSidebarRow } from '../TimelineSidebarRow';
import { TimelineTableProvider } from '../TimelineTable';

const mockFieldTypes: Record<string, FieldType> = {
  assignee: FieldType.Person,
  files: FieldType.Media,
  count: FieldType.Number,
  author: FieldType.CreatedBy,
};
const mockTableFieldTypes: ReadonlyMap<string, FieldType> = new Map(Object.entries(mockFieldTypes));

// jsdom drops a `var()` width, so the column widths are plain pixels here.
const mockColumnWidth = (fieldId: string) => `${100 + fieldId.length}px`;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../table-layout', () => ({
  ...jest.requireActual('../table-layout'),
  timelineColumnWidthStyle: (fieldId: string) => ({ width: mockColumnWidth(fieldId) }),
}));
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  useRowMetaSelector: () => undefined,
}));
jest.mock('@/components/database/components/drag-and-drop/useRowDnd', () => ({
  useRowDnd: () => ({ dragging: false, ignoreClickRef: { current: false } }),
}));
jest.mock('@/components/database/list/ListSortState', () => ({ useListHasSorts: () => false }));
jest.mock('@/components/database/list/ListRowActions', () => ({ RowActionsMenu: () => null }));
jest.mock('@/components/database/gallery/GalleryRowIcon', () => ({ GalleryRowIcon: () => null }));
jest.mock('@/components/database/components/field/CardField', () => ({
  CardField: ({ fieldId }: { fieldId: string }) => <span data-testid={`card-field-${fieldId}`} />,
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

function renderRow(tableFieldIds = Object.keys(mockFieldTypes)) {
  return render(
    <TimelineTableProvider contentWidth={600} viewportWidth={600}>
      <TimelineSidebarRow
        row={{ rowId: 'row', title: 'Task', start: new Date(2026, 8, 16), allDay: true, isRange: false }}
        editable={false}
        rowActions={{ addAbove: jest.fn(), addBelow: jest.fn(), duplicate: jest.fn() }}
        tableFieldIds={tableFieldIds}
        tableFieldTypes={mockTableFieldTypes}
        dropTargetRef={{ current: null }}
      />
    </TimelineTableProvider>
  );
}

const cell = (fieldId: string) => screen.getByTestId(`timeline-table-cell-row-${fieldId}`);

test('table cells use the desktop list card cell style map', () => {
  renderRow();

  // Only the property cells drop to caption; the title keeps the row's body text.
  const root = screen.getByTestId('timeline-sidebar-cell-row');

  expect(root.className).toContain('text-sm');
  expect(root.className).toContain('text-text-primary');

  for (const fieldId of Object.keys(mockFieldTypes)) {
    const element = cell(fieldId);

    expect(element.className).toContain('text-xs');
    expect(element.className).toContain('leading-[18px]');
    expect(element.className).toContain('font-normal');
    // Column geometry and the e2e hooks are unchanged.
    expect(element.className).toContain('border-l');
    expect(element.className).toContain('px-2');
    expect(element.className).toContain('h-full');
    expect(element.className).toContain('overflow-hidden');
    expect(element.style.width).toBe(mockColumnWidth(fieldId));
    expect(element.getAttribute('data-field-type')).toBe(String(mockFieldTypes[fieldId]));
    expect(element.querySelector(`[data-testid="card-field-${fieldId}"]`)).not.toBeNull();
  }

  // Person: avatars only (hideName: true); the names stay for screen readers.
  expect(cell('assignee').className).toContain('[&_.person-cell-name]:sr-only');
  expect(cell('assignee').className).toContain('text-text-primary');
  // Media ignores the map's text style and keeps the secondary color.
  expect(cell('files').className).toContain('text-text-secondary');
  expect(cell('files').className).not.toContain('text-text-primary');
  expect(cell('files').className).not.toContain('sr-only');
  expect(cell('count').className).toContain('text-text-primary');
  expect(cell('count').className).not.toContain('sr-only');
  // CreatedBy keeps its name (PersonCardCellStyle without hideName).
  expect(cell('author').className).toContain('text-text-primary');
  expect(cell('author').className).not.toContain('sr-only');
});

test('a column whose field is gone falls back to the plain caption style', () => {
  renderRow(['ghost']);

  const element = cell('ghost');

  expect(element.className).toContain('text-xs');
  expect(element.className).toContain('text-text-primary');
  expect(element.className).not.toContain('sr-only');
  expect(element.hasAttribute('data-field-type')).toBe(false);
  expect(element.querySelector('[data-testid="card-field-ghost"]')).not.toBeNull();
});
