/**
 * SlashPanel — the "/" command menu in the AppFlowy editor.
 *
 * This file is intentionally thin. All state, options, and business logic
 * live in `useSlashPanelState`; sub-components handle their own rendering.
 *
 * Before refactor: 1,415 lines (monolith)
 * After refactor:  ~70 lines (orchestrator)
 */
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover } from '@/components/_shared/popover';

import { LinkedDatabasePicker } from './LinkedDatabasePicker';
import { SlashPanelItem } from './SlashPanelItem';
import { useSlashPanelState } from './useSlashPanelState';

export function SlashPanel({
  setEmojiPosition,
}: {
  setEmojiPosition: (position: { top: number; left: number }) => void;
}) {
  const { t } = useTranslation();
  const {
    open, panelPosition, transformOrigin, closePanel,
    options, selectedOption, optionsRef, handleSelectOption,
    linkedPicker, linkedTransformOrigin,
    databaseSearch, setDatabaseSearch,
    databaseLoading, databaseError,
    filteredDatabaseTree, allowedDatabaseIds,
    handleSelectDatabase, closeLinkedPicker,
  } = useSlashPanelState(setEmojiPosition);

  return (
    <>
      {/* Main slash menu */}
      <Popover
        adjustOrigins={false}
        data-testid={'slash-panel'}
        open={open}
        onClose={closePanel}
        anchorReference={'anchorPosition'}
        anchorPosition={panelPosition}
        disableAutoFocus={true}
        disableRestoreFocus={true}
        disableEnforceFocus={true}
        transformOrigin={transformOrigin}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div
          ref={optionsRef}
          className={'appflowy-scroller flex max-h-[400px] w-[320px] flex-col gap-2 overflow-y-auto overflow-x-hidden p-2'}
        >
          {options.length > 0 ? (
            options.map((option) => (
              <SlashPanelItem
                key={option.key}
                option={option}
                isSelected={selectedOption === option.key}
                onSelect={handleSelectOption}
              />
            ))
          ) : (
            <div className={'flex items-center justify-center py-4 text-sm text-text-secondary'}>
              {t('findAndReplace.noResult')}
            </div>
          )}
        </div>
      </Popover>

      {/* Linked database sub-picker */}
      <LinkedDatabasePicker
        open={!!linkedPicker}
        position={linkedPicker?.position}
        transformOrigin={linkedTransformOrigin}
        databaseSearch={databaseSearch}
        onSearchChange={setDatabaseSearch}
        databaseLoading={databaseLoading}
        databaseError={databaseError}
        filteredDatabaseTree={filteredDatabaseTree}
        allowedDatabaseIds={allowedDatabaseIds}
        onSelect={handleSelectDatabase}
        onClose={closeLinkedPicker}
      />
    </>
  );
}

export default SlashPanel;
