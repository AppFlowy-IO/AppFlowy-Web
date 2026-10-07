import HrefPopover from '@/components/editor/components/leaf/href/HrefPopover';
import { useLeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { MentionPanel } from '@/components/editor/components/panels/mention-panel/MentionPanel';

import { RichTextCellToolbar } from './RichTextCellToolbar';

/** Optional menus load independently of the cell's input and draft lifetime. */
export function RichTextCellEditorControls({
  onPersonPicked,
}: {
  onPersonPicked: (id: string, requireNotification: boolean) => void;
}) {
  const { linkOpen, closeLinkPopover } = useLeafContext();

  return (
    <>
      <RichTextCellToolbar />
      <MentionPanel notifyOnInsert={false} onPersonPicked={onPersonPicked} />
      <HrefPopover open={!!linkOpen} onClose={() => closeLinkPopover?.()} />
    </>
  );
}
