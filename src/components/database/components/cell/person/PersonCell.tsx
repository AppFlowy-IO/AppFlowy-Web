import { useCallback, useMemo } from 'react';

import { CellProps, PersonCell as PersonCellType } from '@/application/database-yjs/cell.type';
import { MentionablePerson } from '@/application/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import PersonCellMenu from './PersonCellMenu';
import { useMentionableUsersWithAutoFetch } from './useMentionableUsers';

/**
 * Reserved id stamped by the cloud's form-submission handler on the
 * Respondent Person field when the submission is anonymous (Public tier
 * or `anonymous=true` workspace tier). Nil UUID won't collide with a
 * real GoTrue auth id, so we render it as the "Anonymous" badge without
 * a member-directory lookup.
 *
 * Keep this constant in sync with `ANONYMOUS_RESPONDENT_UUID` on the
 * cloud (`src/biz/forms/submit.rs`) and the desktop renderer.
 */
const ANONYMOUS_RESPONDENT_ID = '00000000-0000-0000-0000-000000000000';

type PersonCellEntry =
  | { kind: 'member'; user: MentionablePerson }
  | { kind: 'anonymous'; key: string };

export function PersonCell({
  cell,
  style,
  placeholder,
  fieldId,
  rowId,
  wrap,
  editing,
  setEditing,
}: CellProps<PersonCellType>) {
  const selectedUserIds = useMemo(() => {
    if (!cell?.data) return [];
    try {
      return JSON.parse(cell.data) as string[];
    } catch {
      return [];
    }
  }, [cell?.data]);

  // Real ids are everything except the anonymous sentinel — only real
  // ids are needed for the mentionable-users fetch (no point asking
  // the server about a sentinel that never appears in the directory).
  // The edit menu still receives the full persisted id list so its
  // write path preserves the sentinel when toggling real members.
  const realUserIds = useMemo(
    () => selectedUserIds.filter((id) => id !== ANONYMOUS_RESPONDENT_ID),
    [selectedUserIds],
  );

  // Skip the network round-trip when the cell contains only the
  // anonymous sentinel — the directory lookup would never match it
  // anyway. Real ids fall through to the cached mentionable users.
  const shouldFetch = realUserIds.length > 0;
  const { users: mentionableUsers } = useMentionableUsersWithAutoFetch(shouldFetch);
  const userById = useMemo(
    () => new Map(mentionableUsers.map((user) => [user.person_id, user] as const)),
    [mentionableUsers],
  );

  const entries = useMemo<PersonCellEntry[]>(() => {
    const out: PersonCellEntry[] = [];

    // Preserve the on-cell order so the row reads left-to-right the
    // same as the underlying YJS array; sorting anonymous to the end
    // would lose authoring intent.
    selectedUserIds.forEach((id, idx) => {
      if (id === ANONYMOUS_RESPONDENT_ID) {
        out.push({ kind: 'anonymous', key: `anon-${idx}` });
        return;
      }

      const user = userById.get(id);

      if (user) out.push({ kind: 'member', user });
    });

    return out;
  }, [selectedUserIds, userById]);

  const isEmpty = entries.length === 0;

  const handleOpenChange = useCallback(
    (status: boolean) => {
      setEditing?.(status);
    },
    [setEditing]
  );

  const renderedEntries = useMemo(() => {
    return entries.map((entry) => {
      if (entry.kind === 'anonymous') {
        return <AnonymousPersonChip key={entry.key} />;
      }

      const { user } = entry;
      const displayName = user.name || user.email || '?';

      return (
        <div key={user.person_id} className="min-w-fit max-w-[120px]">
          <div className="flex items-center gap-1">
            <Avatar className="h-5 w-5">
              <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
              <AvatarFallback className="text-xs">{displayName}</AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{displayName}</span>
          </div>
        </div>
      );
    });
  }, [entries]);

  return (
    <div
      style={style}
      data-testid={`person-cell-${rowId}-${fieldId}`}
      className={cn(
        'select-option-cell flex w-full items-center gap-1',
        isEmpty && placeholder ? 'text-text-tertiary' : '',
        wrap
          ? 'flex-wrap overflow-x-hidden'
          : 'appflowy-hidden-scroller h-full w-full flex-nowrap overflow-x-auto overflow-y-hidden'
      )}
    >
      {isEmpty ? placeholder || null : renderedEntries}
      {editing ? (
        <PersonCellMenu
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
          selectedUserIds={selectedUserIds}
        />
      ) : null}
    </div>
  );
}

/**
 * Notion-parity "Anonymous" chip (Image #34) — neutral pill with a
 * generic glyph + label. Visually similar to a real member entry so the
 * row stays readable, but tinted with `text-tertiary` so it doesn't
 * masquerade as an actual workspace member.
 */
function AnonymousPersonChip() {
  return (
    <div className="min-w-fit max-w-[120px]">
      <div className="flex items-center gap-1">
        <Avatar className="h-5 w-5 bg-fill-content">
          <AvatarFallback className="text-xs text-text-tertiary">·</AvatarFallback>
        </Avatar>
        <span className="truncate text-sm text-text-tertiary">Anonymous</span>
      </div>
    </div>
  );
}
