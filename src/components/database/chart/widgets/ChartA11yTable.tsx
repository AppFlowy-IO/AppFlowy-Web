import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChartA11yRow {
  key: string;
  label: string;
  /** The raw value (BDD steps read it instead of parsing compact labels). */
  value: number;
  /** R-FORMAT `tooltip` text. */
  valueText: string;
  color?: string;
}

/**
 * A visually hidden table of the charted data (WP10 §2.4): screen readers
 * get every category, including labels the axis thinned out, and tests read
 * raw values and colors from its rows.
 *
 * Memoized: the chart frame renders on every hover change (the tooltip), and
 * the rows keep their identity until the data changes (W13).
 */
export const ChartA11yTable = memo(function ChartA11yTable({ rows }: { rows: ChartA11yRow[] }) {
  const { t } = useTranslation();

  return (
    <table aria-label={t('chart.a11y.table', { defaultValue: 'Chart data' })} className='sr-only' data-testid='chart-data-table'>
      <tbody>
        {rows.map((row) => (
          <tr data-color={row.color} data-key={row.key} data-label={row.label} data-value={row.value} key={row.key}>
            <th scope='row'>{row.label}</th>
            <td>{row.valueText}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

export default ChartA11yTable;
