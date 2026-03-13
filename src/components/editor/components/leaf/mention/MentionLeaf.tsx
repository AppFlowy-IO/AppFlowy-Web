import React, { useMemo } from 'react';
import { Element, Text } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { Mention, MentionType } from '@/application/types';
import { useLeafSelected } from '@/components/editor/components/leaf/leaf.hooks';
import MentionDate from '@/components/editor/components/leaf/mention/MentionDate';
import MentionExternalLink from '@/components/editor/components/leaf/mention/MentionExternalLink';
import MentionPage from '@/components/editor/components/leaf/mention/MentionPage';
import { MentionPerson } from '@/components/editor/components/leaf/mention/MentionPerson';

export function MentionLeaf({ mention, text, children }: { mention: Mention; text: Text; children: React.ReactNode }) {
  const editor = useSlateStatic();
  const readonly = useReadOnly() || editor.isElementReadOnly(text as unknown as Element);
  const { type, date, page_id, reminder_id, reminder_option, block_id, url, person_id, person_name, include_time } = mention;

  const reminder = useMemo(() => {
    return reminder_id ? { id: reminder_id ?? '', option: reminder_option ?? '' } : undefined;
  }, [reminder_id, reminder_option]);

  const content = useMemo(() => {
    if ([MentionType.PageRef, MentionType.childPage].includes(type) && page_id) {
      return <MentionPage text={text} type={type} pageId={page_id} blockId={block_id} />;
    }

    if (type === MentionType.Date && date) {
      return <MentionDate date={date} reminder={reminder} includeTime={include_time} text={text} />;
    }

    if (type === MentionType.externalLink && url) {
      return <MentionExternalLink url={url} />;
    }

    if (type === MentionType.Person && person_id) {
      return <MentionPerson type={type} personId={person_id} person_name={person_name} />;
    }
  }, [type, page_id, date, text, block_id, reminder, url, person_id, person_name, include_time]);

  // check if the mention is selected
  const { isSelected, select, isCursorBefore } = useLeafSelected(text);
  const className = useMemo(() => {
    const classList = ['w-fit mention', 'relative', 'rounded-[2px]', 'py-0.5  px-1'];

    if (readonly) classList.push('cursor-default');
    else classList.push('cursor-pointer');

    if (isSelected) classList.push('selected');
    return classList.join(' ');
  }, [readonly, isSelected]);

  const ref = React.useRef<HTMLSpanElement>(null);

  return (
    <>
      <span
        style={{
          left: isCursorBefore ? 0 : 'auto',
          right: isCursorBefore ? 'auto' : 0,
          top: isCursorBefore ? 0 : 'auto',
          bottom: isCursorBefore ? 'auto' : 0,
        }}
        className={'absolute bottom-0 right-0 overflow-hidden !text-transparent'}
      >
        {children}
      </span>

      <span ref={ref} onClick={select} contentEditable={false} className={className}>
        {content}
      </span>
    </>
  );
}

export default MentionLeaf;
