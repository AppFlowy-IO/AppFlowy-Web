import { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { DraftMention, updateDraftMentions } from '@/application/comment-mentions';
import { MentionablePerson } from '@/application/types';
import {
  CommentMentionAwareness,
  useCommentMentionPicker,
} from '@/components/_shared/comment-mention/useCommentMentionPicker';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { cn } from '@/lib/utils';

export interface CommentDraft {
  content: string;
  mentions: DraftMention[];
}

export const EMPTY_COMMENT_DRAFT: CommentDraft = { content: '', mentions: [] };

interface InlineCommentInputProps extends Omit<ComponentProps<typeof TextareaAutosize>, 'value' | 'onChange'> {
  draft: CommentDraft;
  onDraftChange: Dispatch<SetStateAction<CommentDraft>>;
  /** People who took part in the thread, the most recent first; a ranked picker lists them first. */
  mentionParticipantIds?: readonly string[];
  /** The page's collaborator awareness; a ranked picker lists who is on the page next. */
  mentionAwareness?: CommentMentionAwareness;
  /** The commenter's person id; a ranked picker lists them last. */
  mentionRequesterId?: string | null;
}

interface MentionQuery {
  start: number;
  end: number;
  text: string;
}

/** Both comment surfaces keep focus in the textarea while choosing a person. */
export const InlineCommentInput = forwardRef<HTMLTextAreaElement, InlineCommentInputProps>(function InlineCommentInput(
  {
    draft,
    onDraftChange,
    mentionParticipantIds,
    mentionAwareness,
    mentionRequesterId,
    disabled,
    onKeyDown,
    onBlur,
    onSelect,
    ...props
  },
  forwardedRef
) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const caretAfterRender = useRef<number | null>(null);
  const listId = useId();
  const open = query !== null && !disabled;
  const { users, loading } = useMentionableUsersWithAutoFetch(open);
  const { suggestions, activeIndex, setActiveIndex, moveActive, resetActive } = useCommentMentionPicker({
    query: open ? query.text : null,
    people: users,
    participantIds: mentionParticipantIds,
    awareness: mentionAwareness,
    requesterId: mentionRequesterId,
  });

  const setInputRef = useCallback(
    (input: HTMLTextAreaElement | null) => {
      inputRef.current = input;
      if (typeof forwardedRef === 'function') forwardedRef(input);
      else if (forwardedRef) forwardedRef.current = input;
    },
    [forwardedRef]
  );

  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId, open]);

  useLayoutEffect(() => {
    if (caretAfterRender.current === null) return;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
    caretAfterRender.current = null;
  }, [draft]);

  const updateQuery = (input: HTMLTextAreaElement, mentions = draft.mentions) => {
    const caret = input.selectionStart;
    const prefix = input.value.slice(0, caret);
    const trigger = /(?:^|\s)@/g;
    let match: RegExpExecArray | null;
    let start = -1;

    // The last standalone @ owns the query; an @ inside an email is searchable.
    while ((match = trigger.exec(prefix)) !== null) start = match.index + match[0].length - 1;
    const text = prefix.slice(start + 1);

    // Moving the caret over a committed label must not reopen its picker.
    if (
      input.selectionEnd !== caret ||
      start === -1 ||
      text.includes('\n') ||
      mentions.some((mention) => mention.start === start)
    ) {
      setQuery(null);
      return;
    }

    setQuery({ start, end: caret, text });
    resetActive();
  };

  const selectPerson = (person: MentionablePerson) => {
    if (!query) return;
    const name = (person.name || person.email).replace(/[\]\r\n]/g, ' ');
    const label = `@${name}`;
    const content = `${draft.content.slice(0, query.start)}${label} ${draft.content.slice(query.end)}`;

    if (props.maxLength && content.length > props.maxLength) return;
    caretAfterRender.current = query.start + label.length + 1;
    onDraftChange({
      content,
      mentions: [
        ...updateDraftMentions(draft.content, content, draft.mentions),
        { start: query.start, end: query.start + label.length, name, personId: person.person_id },
      ],
    });
    setQuery(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery(null);
      }}
    >
      <PopoverAnchor asChild>
        <div ref={setContainer} className='min-w-0 flex-1'>
          <TextareaAutosize
            {...props}
            ref={setInputRef}
            disabled={disabled}
            value={draft.content}
            role='combobox'
            aria-label={props['aria-label'] || props.placeholder}
            aria-autocomplete='list'
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            aria-activedescendant={open && suggestions.length ? `${listId}-${activeIndex}` : undefined}
            onChange={(event) => {
              const content = event.target.value;
              const mentions = updateDraftMentions(draft.content, content, draft.mentions);

              onDraftChange({ content, mentions });
              updateQuery(event.target, mentions);
            }}
            onSelect={(event) => {
              // Insertion restores the caret before selection events are delivered.
              if (caretAfterRender.current === null) updateQuery(event.currentTarget);
              onSelect?.(event);
            }}
            onBlur={(event) => {
              setQuery(null);
              onBlur?.(event);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (open && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setQuery(null);
                return;
              }

              if (
                open &&
                suggestions.length &&
                ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) &&
                !event.shiftKey
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Enter') selectPerson(suggestions[activeIndex]);
                else moveActive(event.key === 'ArrowDown' ? 1 : -1);
                return;
              }

              if (event.key === 'Tab') setQuery(null);
              onKeyDown?.(event);
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        // Keep the portaled options inside the compose popup's outside-click boundary.
        container={container}
        align='start'
        side='top'
        sideOffset={4}
        className='z-[1600] w-72 max-w-[calc(100vw-16px)] bg-surface-layer-04 p-2'
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Radix observes Escape before the textarea. Let its handler dismiss only
        // the suggestions, rather than closing the parent comment in the same keypress.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (container?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div
          id={listId}
          role='listbox'
          aria-label={t('settings.appearance.people.label')}
          aria-busy={loading}
          className='appflowy-scroller max-h-64 overflow-y-auto'
        >
          {suggestions.map((person, index) => (
            <button
              key={person.person_id}
              id={`${listId}-${index}`}
              type='button'
              role='option'
              tabIndex={-1}
              aria-selected={index === activeIndex}
              data-person-id={person.person_id}
              data-person-name={person.name || person.email}
              className={cn(
                'flex w-full items-center gap-2 rounded-200 px-2 py-1.5 text-left text-sm text-text-primary hover:bg-fill-content-hover',
                index === activeIndex && 'bg-fill-theme-select'
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => selectPerson(person)}
            >
              <Avatar className='h-6 w-6 shrink-0'>
                <AvatarImage src={person.avatar_url || undefined} />
                <AvatarFallback>{(person.name || person.email).slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className='min-w-0 flex-1'>
                <span className='block truncate'>{person.name || person.email}</span>
                <span className='block truncate text-xs text-text-secondary'>{person.email}</span>
              </span>
            </button>
          ))}
          {suggestions.length === 0 && (
            <div role='status' className='px-2 py-1.5 text-sm text-text-secondary'>
              {t(loading ? 'loading' : 'findAndReplace.noResult')}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
