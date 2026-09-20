import { renderHook } from '@testing-library/react';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';

import { useTimelinePermissions } from '../hooks/useTimelinePermissions';

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  useFieldSelector: jest.fn(),
  useReadOnly: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(useReadOnly).mockReturnValue(false);
  jest.mocked(useFieldSelector).mockImplementation((id) => {
    const type = {
      date: FieldType.DateTime,
      created: FieldType.CreatedTime,
      edited: FieldType.LastEditedTime,
      text: FieldType.RichText,
    }[id];

    return { field: type === undefined ? undefined : { get: () => type } } as ReturnType<typeof useFieldSelector>;
  });
});

test.each([
  ['date', '', true],
  ['date', 'date', true],
  ['created', '', false],
  ['edited', '', false],
  ['date', 'created', false],
  ['date', 'edited', false],
  ['date', 'missing', false],
  ['text', '', false],
  ['missing', '', false],
])('start %s and end %s allow date gestures: %s', (start, end, dateEditable) => {
  const { result } = renderHook(() => useTimelinePermissions(start, end));

  expect(result.current.dateEditable).toBe(dateEditable);
  expect(result.current.editable).toBe(true);
});

test('read-only timelines disable both property and date editing', () => {
  jest.mocked(useReadOnly).mockReturnValue(true);
  const { result } = renderHook(() => useTimelinePermissions('date'));

  expect(result.current.editable).toBe(false);
  expect(result.current.dateEditable).toBe(false);
});
