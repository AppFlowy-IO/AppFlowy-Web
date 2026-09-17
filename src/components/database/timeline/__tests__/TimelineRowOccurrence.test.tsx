import { fireEvent, render, screen } from '@testing-library/react';

import { TimelineRow } from '../TimelineRow';

import type { PointerEvent } from 'react';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

jest.mock('../TimelineSidebarRow', () => ({ TimelineSidebarRow: () => null }));
jest.mock('../TimelineBar', () => ({
  TimelineBar: ({ onLinkPointerDown }: { onLinkPointerDown: (event: PointerEvent<HTMLElement>) => void }) => (
    <button data-testid='connector' onPointerDown={onLinkPointerDown}>
      Connect
    </button>
  ),
}));

test('a connector identifies the pressed occurrence of a row shared by groups', () => {
  const row = { rowId: 'shared', title: 'Shared', allDay: true, isRange: false };
  const rect = { left: 40, width: 80 };
  const onLinkPointerDown = jest.fn();

  render(
    <>
      {[1, 5].map((rowIndex) => (
        <TimelineRow
          key={rowIndex}
          row={row}
          rect={rect}
          rowIndex={rowIndex}
          sidebarWidth={280}
          showSidebar
          editable
          dateEditable
          propertyFields={[]}
          tableFieldIds={[]}
          offscreenLeft={false}
          offscreenRight={false}
          rowActions={{ addAbove: jest.fn(), addBelow: jest.fn(), duplicate: jest.fn() }}
          formatTime={() => ''}
          onLinkPointerDown={onLinkPointerDown}
        />
      ))}
    </>
  );
  const handles = screen.getAllByTestId('connector');

  fireEvent.pointerDown(handles[0]);
  expect(onLinkPointerDown.mock.calls[0].slice(1)).toEqual([row, rect, 1]);
  fireEvent.pointerDown(handles[1]);
  expect(onLinkPointerDown.mock.calls[1].slice(1)).toEqual([row, rect, 5]);
});
