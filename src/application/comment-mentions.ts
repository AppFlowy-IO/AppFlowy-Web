export interface DraftMention {
  start: number;
  end: number;
  name: string;
  personId: string;
}

/** Keep only intact mentions when text is inserted, replaced, or deleted. */
export function updateDraftMentions(previous: string, next: string, mentions: DraftMention[]): DraftMention[] {
  let start = 0;

  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length;
  let nextEnd = next.length;

  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }

  const offset = next.length - previous.length;

  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end) return [{ ...mention, start: mention.start + offset, end: mention.end + offset }];
    return [];
  });
}

/** Desktop stores person mentions as Markdown tokens; the input shows names. */
export function serializeCommentMentions(content: string, mentions: DraftMention[]): string {
  return [...mentions]
    .sort((a, b) => b.start - a.start)
    .reduce((text, mention) => {
      if (content.slice(mention.start, mention.end) !== `@${mention.name}`) return text;
      return `${text.slice(0, mention.start)}@[${mention.name}](${mention.personId})${text.slice(mention.end)}`;
    }, content);
}
