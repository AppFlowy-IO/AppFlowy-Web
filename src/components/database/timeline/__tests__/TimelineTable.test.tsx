import { fireEvent, render, screen } from '@testing-library/react';

import { TimelineTableProvider, TimelineTableViewport, timelineTableViewportWidth } from '../TimelineTable';

test('a wide table leaves canvas space and scrolls headers, cells, and new virtual rows together', () => {
  const contentWidth = 1400;
  const viewportWidth = timelineTableViewportWidth(contentWidth, 1280);
  const table = (extra: boolean) => (
    <TimelineTableProvider contentWidth={contentWidth} viewportWidth={viewportWidth}>
      <TimelineTableViewport>Header</TimelineTableViewport>
      <TimelineTableViewport>First row</TimelineTableViewport>
      {extra ? <TimelineTableViewport>New virtual row</TimelineTableViewport> : null}
      <TimelineTableViewport scrollbar />
    </TimelineTableProvider>
  );
  const rendered = render(table(false));
  const header = screen.getAllByTestId('timeline-table-viewport')[0];

  expect(1280 - viewportWidth).toBeGreaterThanOrEqual(240);
  header.scrollLeft = 600;
  fireEvent.scroll(header);
  expect(screen.getAllByTestId('timeline-table-viewport')[1].scrollLeft).toBe(600);
  expect(screen.getByTestId('timeline-table-scrollbar').scrollLeft).toBe(600);

  rendered.rerender(table(true));
  expect(screen.getAllByTestId('timeline-table-viewport')[2].scrollLeft).toBe(600);
});

test('the scrollbar registers when added properties first cause overflow', () => {
  const table = (contentWidth: number) => (
    <TimelineTableProvider contentWidth={contentWidth} viewportWidth={280}>
      <TimelineTableViewport>Header</TimelineTableViewport>
      <TimelineTableViewport scrollbar />
    </TimelineTableProvider>
  );
  const rendered = render(table(280));

  expect(screen.queryByTestId('timeline-table-scrollbar')).toBeNull();
  rendered.rerender(table(1400));
  const header = screen.getByTestId('timeline-table-viewport');

  header.scrollLeft = 500;
  fireEvent.scroll(header);
  expect(screen.getByTestId('timeline-table-scrollbar').scrollLeft).toBe(500);
});
