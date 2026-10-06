import alignLeft from '@/assets/icons/simple-table/align-left.svg?url';
import clearContents from '@/assets/icons/simple-table/clear-contents.svg?url';
import convertText from '@/assets/icons/simple-table/convert-text.svg?url';
import copyLink from '@/assets/icons/simple-table/copy-link.svg?url';
import deleteColumn from '@/assets/icons/simple-table/delete-column.svg?url';
import deleteRow from '@/assets/icons/simple-table/delete-row.svg?url';
import distribute from '@/assets/icons/simple-table/distribute-columns.svg?url';
import duplicate from '@/assets/icons/simple-table/duplicate.svg?url';
import insertColumnLeft from '@/assets/icons/simple-table/insert-column-left.svg?url';
import insertColumnRight from '@/assets/icons/simple-table/insert-column-right.svg?url';
import insertRowAbove from '@/assets/icons/simple-table/insert-row-above.svg?url';
import insertRowBelow from '@/assets/icons/simple-table/insert-row-below.svg?url';
import setPageWidth from '@/assets/icons/simple-table/set-page-width.svg?url';
import submenuArrow from '@/assets/icons/simple-table/submenu-arrow.svg?url';
import turnInto from '@/assets/icons/simple-table/turn-into.svg?url';
import header from '@/assets/icons/table_header.svg?url';

import { SimpleTableFigmaIcon } from './SimpleTableFigmaIcon';

function mask(source: string) {
  const image = `url(${JSON.stringify(source)})`;

  return { maskImage: image, WebkitMaskImage: image };
}

const assets = {
  align: mask(alignLeft),
  clearContents: mask(clearContents),
  deleteColumn: mask(deleteColumn),
  deleteRow: mask(deleteRow),
  copyLink: mask(copyLink),
  turnInto: mask(turnInto),
  convertText: mask(convertText),
  duplicate: mask(duplicate),
  header: mask(header),
  insertColumnLeft: mask(insertColumnLeft),
  insertColumnRight: mask(insertColumnRight),
  insertRowAbove: mask(insertRowAbove),
  insertRowBelow: mask(insertRowBelow),
  setPageWidth: mask(setPageWidth),
  submenuArrow: mask(submenuArrow),
};

function Icon({ name, className = '' }: { name: keyof typeof assets; className?: string }) {
  return <span className={`simple-table-menu-icon ${className}`} style={assets[name]} aria-hidden="true" />;
}

// Static elements and masks stay stable while the table's hover context changes.
export const SimpleTableMenuIcons = {
  align: <Icon name="align" />,
  clearContents: <Icon name="clearContents" />,
  color: <span className="simple-table-menu-color-icon" aria-hidden="true" />,
  deleteColumn: <Icon name="deleteColumn" />,
  deleteRow: <Icon name="deleteRow" />,
  distribute: <SimpleTableFigmaIcon
    source={distribute}
    inkLuminance={(0.2126 * 31 + 0.7152 * 35 + 0.0722 * 41) / 255}
    className="simple-table-menu-icon"
  />,
  copyLink: <Icon name="copyLink" />,
  turnInto: <Icon name="turnInto" />,
  convertText: <Icon name="convertText" />,
  duplicate: <Icon name="duplicate" />,
  headerColumn: <Icon name="header" className="header column" />,
  headerRow: <Icon name="header" className="header" />,
  insertColumnLeft: <Icon name="insertColumnLeft" />,
  insertColumnRight: <Icon name="insertColumnRight" className="insert-column-right" />,
  insertRowAbove: <Icon name="insertRowAbove" className="insert-row-above" />,
  insertRowBelow: <Icon name="insertRowBelow" className="insert-row-below" />,
  setPageWidth: <Icon name="setPageWidth" className="set-page-width" />,
  submenuArrow: <Icon name="submenuArrow" className="submenu-arrow" />,
};
