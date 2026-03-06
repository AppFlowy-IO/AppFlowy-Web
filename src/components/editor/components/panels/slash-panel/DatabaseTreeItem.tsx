import { memo, useState } from 'react';

import { View } from '@/application/types';
import { ReactComponent as AddPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/toggle_list.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Button as OutlineButton } from '@/components/ui/button';

interface DatabaseTreeItemProps {
  view: View;
  allowedIds: Set<string>;
  onSelect: (view: View) => void;
  fallbackTitle: string;
  isSearching?: boolean;
}

/**
 * Recursive tree item for the linked-database picker.
 * Extracted from SlashPanel to enable independent memoization and reduce file size.
 */
export const DatabaseTreeItem: React.FC<DatabaseTreeItemProps> = memo(function DatabaseTreeItem({
  view,
  allowedIds,
  onSelect,
  fallbackTitle,
  isSearching,
}) {
  const [expanded, setExpanded] = useState(view.extra?.is_space || false);
  const effectiveExpanded = isSearching ? true : expanded;
  const isDatabase = allowedIds.has(view.view_id);
  const hasChildren = view.children?.length > 0;
  const name = view.name || fallbackTitle;

  return (
    <div className={'flex flex-col'}>
      <div
        onClick={() => {
          if (!hasChildren) {
            if (isDatabase) onSelect(view);
            return;
          }

          if (isDatabase) onSelect(view);
          if (!isSearching) setExpanded((prev) => !prev);
        }}
        className={
          'flex h-[28px] w-full cursor-pointer select-none items-center justify-between gap-2 rounded-[8px] px-1.5 text-sm hover:bg-muted'
        }
      >
        <div className={'flex w-full items-center gap-2 overflow-hidden'}>
          {hasChildren ? (
            <OutlineButton
              variant={'ghost'}
              className={'!h-4 !min-h-4 !w-4 !min-w-4 !p-0 hover:bg-muted-foreground/10'}
              onClick={(e) => {
                e.stopPropagation();
                if (!isSearching) setExpanded((prev) => !prev);
              }}
            >
              <ChevronRight
                className={`transform transition-transform ${effectiveExpanded ? 'rotate-90' : 'rotate-0'}`}
              />
            </OutlineButton>
          ) : (
            <div style={{ width: 16, height: 16 }} />
          )}
          <PageIcon view={view} className={'flex h-5 w-5 min-w-5 items-center justify-center'} />
          <span className={'flex-1 truncate'}>{name}</span>
        </div>

        {isDatabase && (
          <div onClick={(e) => { e.stopPropagation(); onSelect(view); }}>
            <OutlineButton variant={'ghost'} className={'!h-5 !w-5 rounded-md !p-0 hover:bg-muted-foreground/10'}>
              <AddPageIcon className={'h-5 w-5'} />
            </OutlineButton>
          </div>
        )}
      </div>

      {hasChildren && effectiveExpanded && (
        <div className={'flex flex-col gap-1 pl-4'}>
          {view.children?.map((child) => (
            <DatabaseTreeItem
              key={child.view_id}
              view={child}
              allowedIds={allowedIds}
              onSelect={onSelect}
              fallbackTitle={fallbackTitle}
              isSearching={isSearching}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default DatabaseTreeItem;
