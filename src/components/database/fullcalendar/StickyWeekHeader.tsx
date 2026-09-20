import { useMemo } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';

import { CalendarViewType, isTimeGridView } from './types';

/**
 * Interface for header cell data
 */
interface HeaderCellData {
  date: Date;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Props for StickyWeekHeader component
 */
interface StickyWeekHeaderProps {
  headerCells?: HeaderCellData[];
  visible: boolean;
  scrollLeft?: number;
  currentView?: CalendarViewType;
  isSticky?: boolean;
}

/**
 * Sticky week header component that manually renders header cells
 * Replicates FullCalendar's header structure with custom data
 */
export function StickyWeekHeader({
  headerCells,
  visible,
  scrollLeft = 0,
  currentView,
  isSticky = false,
}: StickyWeekHeaderProps) {
  const { paddingStart, paddingEnd } = useDatabaseContext();

  // Memoized style object matching calendar spacing
  const containerStyle = useMemo(
    () => ({
      marginLeft: paddingStart === undefined ? undefined : paddingStart,
      marginRight: paddingEnd === undefined ? undefined : paddingEnd,
    }),
    [paddingStart, paddingEnd]
  );

  // Memoized className matching calendar spacing
  const containerClassName = useMemo(
    () => `mx-24 bg-background-primary max-sm:!mx-6 overflow-hidden ${isSticky ? 'border-b border-border-primary' : ''}`, // Same as calendar container + hide overflow
    [isSticky]
  );

  // Check if we should show the time slot column
  const showTimeSlotColumn = useMemo(() => {
    return isTimeGridView(currentView);
  }, [currentView]);

  if (!visible || headerCells?.length === 0) {
    return null;
  }

  return (
    <div style={containerStyle} className={containerClassName}>
      <div className='fc fc-theme-standard database-calendar sticky-header-wrapper'>
        <div className='fc-scrollgrid' style={{ border: 'none', width: '100%' }}>
          <table
            className='fc-scrollgrid-sync-table'
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              transform: `translateX(-${scrollLeft}px)`,
            }}
          >
            <thead className='fc-scrollgrid-section fc-scrollgrid-section-header'>
              <tr className='fc-col-header-row'>
                {/* Time slot column for week view */}
                {showTimeSlotColumn && (
                  <th
                    className='fc-col-header-cell fc-timegrid-axis-cell'
                    style={{
                      width: 'var(--fc-timegrid-axis-width)',
                      minWidth: 'var(--fc-timegrid-axis-width)',
                      maxWidth: 'var(--fc-timegrid-axis-width)',
                      height: '32px',
                      minHeight: '32px',
                      maxHeight: '32px',
                      padding: 0,
                      backgroundColor: 'var(--fill-content)',
                      border: 'none',
                      borderBottom: '1px solid var(--border-primary)',
                    }}
                  >
                    <div
                      style={{
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                      }}
                    >
                      {/* Empty or could show "all-day" label */}
                    </div>
                  </th>
                )}

                {/* Date columns */}
                {headerCells?.map((cell, index) => (
                  <th
                    key={index}
                    className={`fc-col-header-cell ${cell.isToday ? 'fc-day-today' : ''} ${
                      cell.isWeekend ? 'fc-day-weekend' : ''
                    }`}
                    style={{
                      width: showTimeSlotColumn
                        ? `calc((100% - var(--fc-timegrid-axis-width)) / ${headerCells.length})`
                        : '14.285714%',
                      height: '32px',
                      minHeight: '32px',
                      maxHeight: '32px',
                      padding: 0,
                      // backgroundColor: cell.isWeekend ? 'var(--surface-container-layer-00)' : 'var(--fill-content)',
                      borderLeft: 'none',
                      borderRight: 'none',
                      borderTop: 'none',
                      borderBottom: '1px solid var(--border-primary)',
                      fontSize: '14px',
                      verticalAlign: 'middle',
                    }}
                  >
                    <div
                      className='fc-col-header-cell-cushion'
                      style={{
                        height: '32px',
                        lineHeight: '32px',
                        padding: '0 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                        fontSize: '0.875rem',
                        letterSpacing: '0.025em',
                        textTransform: 'capitalize',
                      }}
                    >
                      {cell.isToday && cell.dayNumber > 0 ? (
                        <span className='flex items-center justify-center gap-1'>
                          {cell.dayName}{' '}
                          <span
                            className='today-date'
                            style={{
                              backgroundColor: 'var(--other-colors-filled-today)',
                              color: 'var(--text-inverse)',
                              borderRadius: '6px',
                              width: '24px',
                              height: '24px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 500,
                              fontSize: '0.875rem',
                            }}
                          >
                            {cell.dayNumber}
                          </span>
                        </span>
                      ) : cell.dayNumber > 0 ? (
                        `${cell.dayName} ${cell.dayNumber}`
                      ) : (
                        cell.dayName
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      </div>
    </div>
  );
}
