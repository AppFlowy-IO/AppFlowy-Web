
import { renderColor } from '@/utils/color';

import { tableColumnWidths, type TableDensity, type TablePage } from './table-pagination';

import type { SourceBlock } from './types';
import type { CSSProperties, ReactNode } from 'react';

export default function DocumentTable({
  block,
  renderContent,
  density = 'comfortable',
  layout,
  maxHeight,
}: {
  block: SourceBlock;
  renderContent: (cell: SourceBlock) => ReactNode;
  density?: TableDensity;
  layout?: TablePage;
  maxHeight?: number;
}) {
  const header = block.table?.headerRow === true ? block.children[0] : undefined;
  const rows = header ? block.children.slice(1) : block.children;
  const widths = layout?.columnWidths ?? tableColumnWidths(block);
  const renderRow = (row: SourceBlock, heading = false) => (
    <tr key={row.id} data-table-row-id={row.id}>
      {row.children.map((cell, index) => {
        const rowHeader = !heading && index === 0 && block.table?.headerColumn === true;
        const Cell = heading || rowHeader ? 'th' : 'td';
        // Native tables apply column fills over header shading, then row fills behind cells.
        const fill = block.table?.columnColors?.[index] || cell.style?.backgroundColor;
        const rowFill = block.table?.rowColors?.[row.id];
        const background = fill
          ? renderColor(fill)
          : heading || rowHeader
          ? 'var(--ps-table-header-background)'
          : undefined;
        const layers = [background, rowFill ? renderColor(rowFill) : undefined].filter(Boolean);
        const align = (
          block.table?.columnAligns?.[index] ||
          block.table?.rowAligns?.[row.id] ||
          cell.style?.align
        )?.toLowerCase();

        return (
          <Cell
            key={cell.id}
            scope={heading ? 'col' : rowHeader ? 'row' : undefined}
            className={index === 0 ? 'ps-table-anchor' : undefined}
            style={{
              backgroundImage: layers.length
                ? layers.map((color) => `linear-gradient(${color}, ${color})`).join(', ')
                : undefined,
              color: cell.style?.color ? renderColor(cell.style.color) : undefined,
              textAlign: align === 'left' || align === 'center' || align === 'right' ? align : undefined,
            }}
          >
            {renderContent(cell)}
          </Cell>
        );
      })}
    </tr>
  );

  return (
    <div className={`ps-table-card ps-table-${layout?.density ?? density}`}>
      <div
        className='ps-table-scroll'
        role='region'
        aria-label='Table content'
        tabIndex={0}
        style={maxHeight ? { maxHeight: Math.max(100, maxHeight - 36) } : undefined}
      >
        <table
          className='ps-table-grid'
          aria-label='Source table'
          style={{ '--ps-table-min-width': `${widths.length * 125}px` } as CSSProperties}
        >
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          {header && <thead>{renderRow(header, true)}</thead>}
          <tbody>{rows.map((row) => renderRow(row))}</tbody>
        </table>
      </div>
      <div className='ps-table-meta'>
        <span>
          {layout?.pageCount && layout.pageCount > 1
            ? `Rows ${layout.rowStart}–${layout.rowEnd} of ${layout.totalRows}`
            : `${layout?.totalRows ?? rows.length} rows`}
        </span>
        <span>
          {layout && layout.pageCount > 1
            ? `Table ${layout.page + 1} of ${layout.pageCount}`
            : `${widths.length} columns`}
        </span>
      </div>
    </div>
  );
}
