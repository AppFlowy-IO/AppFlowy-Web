import { ReactNode, useState } from 'react';

import { SearchInput } from '@/components/chat/components/ui/search-input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';


import { SpaceList } from './space-list';

export function PromptDatabaseViews({
  onSelectView,
  children,
}: {
  onSelectView: (viewId: string) => void;
  children: ReactNode;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleSelectDatabaseView = (viewId: string) => {
    if (!viewId) return;
    onSelectView(viewId);
    setIsOpen(false);
  };

  return (
    <Popover modal open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent>
        <div className='h-fit min-h-[200px] max-h-[360px] w-[300px] flex flex-col'>
          <SearchInput value={searchValue} onChange={setSearchValue} className='m-2' />
          <Separator />
          <div className='overflow-x-hidden overflow-y-auto flex-1 appflowy-scrollbar p-2'>
            <SpaceList
              searchValue={searchValue}
              onSelectDatabaseView={handleSelectDatabaseView}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
