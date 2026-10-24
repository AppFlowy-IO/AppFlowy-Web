import { render } from '@testing-library/react';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';

import { CHART_PANEL_ROW_ICONS, chartPanelIconOf } from '../chartPanelIcon';

const { rowIcons } = loadParityFixture<{ rowIcons: Record<string, string> }>('chart-panel.json');

describe('chart panel row icons (dashboard-parity/chart-panel.json#rowIcons)', () => {
  it('uses the shared logical icon of every row', () => {
    expect(CHART_PANEL_ROW_ICONS).toEqual(rowIcons);
  });

  it('draws an icon for each listed row and none for the others', () => {
    Object.keys(rowIcons).forEach((rowId) => {
      const { container, unmount } = render(<>{chartPanelIconOf(rowId)}</>);

      expect(container.firstChild).not.toBeNull();
      unmount();
    });
    expect(chartPanelIconOf('chart_type')).toBeNull();
    expect(chartPanelIconOf('number_title_input')).toBeNull();
  });
});
