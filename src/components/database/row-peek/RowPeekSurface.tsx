import { Dialog } from '@mui/material';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useRowPeekLayout } from './RowPeekLayout';

import type { ReactNode } from 'react';

export type RowPeekMode = 'side' | 'center';

/** The portal target stays the same when shells change, so editors never remount. */
export function RowPeekSurface({
  children,
  mode,
  open,
  hideBackdrop,
  onClose,
  prepare,
  closeImmediately,
}: {
  children: ReactNode;
  mode: RowPeekMode;
  open: boolean;
  hideBackdrop?: boolean;
  onClose: () => void;
  prepare: () => Promise<boolean>;
  closeImmediately: () => void;
}) {
  const { t } = useTranslation();
  const layout = useRowPeekLayout();
  const canShow = layout?.canShow === true && !hideBackdrop;
  const side = mode === 'side' && canShow;
  const [id] = useState(() => Symbol('row-peek'));
  const [content] = useState(() => document.createElement('div'));
  const [center, setCenter] = useState<HTMLDivElement | null>(null);
  const [attached, setAttached] = useState(false);
  // A page-modal peek has its own shell. Other peeks retain their page claim
  // for their lifetime, even while resizing or changing modes hides the side slot.
  const [requiresClaim] = useState(() => Boolean(layout && !hideBackdrop));
  const callbacks = useRef({ prepare, closeImmediately });

  useLayoutEffect(() => {
    callbacks.current = { prepare, closeImmediately };
  });

  const claim = layout?.claim;
  const release = layout?.release;
  const showSide = layout?.showSide;
  const authorized = !requiresClaim || layout?.owner === id;

  useLayoutEffect(() => {
    if (!open || !requiresClaim || !claim || !release) return;
    let current = true;

    void claim(
      {
        id,
        prepare: () => callbacks.current.prepare(),
        close: () => callbacks.current.closeImmediately(),
      },
      () => current
    ).then((accepted) => {
      if (current && !accepted) callbacks.current.closeImmediately();
    });

    return () => {
      current = false;
      release(id);
    };
  }, [claim, id, open, release, requiresClaim]);

  useLayoutEffect(() => {
    if (requiresClaim && authorized) showSide?.(id, open && side);
  }, [authorized, id, open, requiresClaim, showSide, side]);

  const destination = authorized ? (side ? layout?.container : center) : null;

  useLayoutEffect(() => {
    content.className = 'flex h-full min-h-0 w-full flex-col';
    if (!destination) return;
    destination.appendChild(content);
    setAttached(true);
    return () => {
      content.remove();
    };
  }, [content, destination]);

  useLayoutEffect(() => {
    if (side) {
      content.setAttribute('role', 'dialog');
      content.setAttribute('aria-label', t('grid.rowPage.sidePeek'));
    } else {
      content.removeAttribute('role');
      content.removeAttribute('aria-label');
    }
  }, [content, side, t]);

  const centerRef = useCallback((node: HTMLDivElement | null) => setCenter(node), []);

  return (
    <>
      <Dialog
        open={open && authorized && !side}
        data-row-peek-open={open && authorized && !side}
        onClose={onClose}
        // The row's document-level Escape handler closes either shell and lets
        // open menus own the key; MUI's own handler would ignore them.
        disableEscapeKeyDown
        fullWidth
        keepMounted
        transitionDuration={side ? 0 : undefined}
        disableRestoreFocus
        hideBackdrop={hideBackdrop}
        aria-label={t('grid.rowPage.centerPeek')}
        PaperProps={{
          sx: { borderRadius: '16px', boxShadow: '0 4px 32px rgb(0 0 0 / 12%)' },
          className:
            'relative flex h-[80vh] w-[1188px] max-w-[70vw] flex-col overflow-hidden max-sm:m-2 max-sm:max-w-[calc(100vw-16px)]',
        }}
      >
        <div ref={centerRef} className='flex h-full min-h-0 w-full flex-col'>
          {/* Keep the portal in the dialog's React tree so its focus trap recognizes
              menus portaled by the row editors, even though the DOM target moves. */}
          {open && authorized && attached ? createPortal(children, content) : null}
        </div>
      </Dialog>
    </>
  );
}
