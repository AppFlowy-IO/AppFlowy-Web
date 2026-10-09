import { Dialog, DialogContent, DialogTitle } from '@mui/material';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { AFScroller } from '@/components/_shared/scroller';
import { useDatabaseRestoreNotice } from '@/components/app/DatabaseRestoreNotice';
import { CenterPeekHeader } from '@/components/database/components/database-row/RowPeekHeader';
import { DatabaseRow } from '@/components/database/DatabaseRow';

function DatabaseRowModal({
  open,
  onOpenChange,
  rowId,
  openPage,
}: {
  open: boolean;
  rowId: string;
  onOpenChange: (open: boolean) => void;
  openPage?: (rowId: string) => void;
}) {
  const context = useDatabaseContextOptional();
  const openPageModalViewId = context?.openPageModalViewId;

  useDatabaseRestoreNotice(context?.workspaceId || '', open ? context?.databaseDoc?.guid : undefined);

  return (
    <Dialog
      open={open}
      onClose={() => {
        onOpenChange(false);
      }}
      fullWidth={true}
      keepMounted={false}
      disableAutoFocus={false}
      disableEnforceFocus={false}
      disableRestoreFocus={true}
      hideBackdrop={!!openPageModalViewId}
      PaperProps={{
        className: `max-w-[70vw] relative w-[1188px] h-[80vh] overflow-hidden flex flex-col`,
      }}
    >
      <DialogContent className={'flex h-full w-full flex-col px-0 py-0'}>
        <DialogTitle className={'flex max-h-[48px] flex-1 items-center justify-end gap-2 px-2'}>
          <CenterPeekHeader onClose={() => onOpenChange(false)} openPage={openPage} rowId={rowId} />
        </DialogTitle>

        <AFScroller overflowXHidden className={'appflowy-scroll-container w-full flex-1'}>
          <DatabaseRow rowId={rowId} />
        </AFScroller>
      </DialogContent>
    </Dialog>
  );
}

export default DatabaseRowModal;
