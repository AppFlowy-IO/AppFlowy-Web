/**
 * The @-mention typeahead contract's matcher and client ranking (MEN-WEB-06), so the picker's local
 * lane and the server's answer tier and order items the same way. The contract is
 * `doc/context/workspace/mention_typeahead_contract.md` in AppFlowy-Cloud-Premium, version 1; its
 * Rust reference is `appflowy_entity::search::mention_match` (the normalizer, title tiers and
 * people classes Search and Cloud rank with) and `mention_typeahead::rank` (the client's in-tier
 * keys). The shared vectors in `__fixtures__/mention-parity/` pin this port to both.
 *
 * - {@link objectTier}: a page's, database's or row's title tier, T0 exact to T3 substring.
 * - {@link personTier}: a person's class, C0 prefix to C3 full address; the domain alone never
 *   matches.
 * - {@link rankSection}: one section's candidates, server items with their position and local-only
 *   items, by tier, then the requester last, pick memory, presence, the client's recency bucket,
 *   server rank, length in code points and the navigation key. A server item that does not match
 *   keeps the last place (T4); a local-only one is dropped.
 * - {@link retierServerSection}: a server section ranked that way, so a body-only hit never sits
 *   above a title match, whatever server answered.
 *
 * Matching reads prepared text: each title, name and address is normalized and split into words
 * once and kept by its own string, so re-ranking on every keystroke only compares, however the
 * candidates are split into sections ({@link PreparedCache}). Nothing here depends on React, the
 * DOM or the network. The editor's picker does not call it yet: it keeps the server's order until
 * MEN-WEB-08 and MEN-WEB-09 use it behind their flag. The comment @ pickers match people with
 * {@link personTier} when their own `ranked` order is on (`@/application/comment-mention-ranking`).
 */
import {
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';
import {
  boundMentionText,
  codePointOrderKey,
  compareCodePoints,
  compareCodeUnits,
  countCodePoints,
  isMentionBlankText,
  normalizeMentionText,
} from '@/utils/normalize-text';

import { mentionItemNavKey } from './mentionUtils';

/** The navigation key of a server item (MEN-WEB-02), which ranking ties break on and merges key by. */
export { mentionItemNavKey };

/** Query tokens word-start matching assigns; a longer query matches only as a whole. */
export const MENTION_MAX_MATCH_TOKENS = 12;
/** Leading words of a title, name or address local part that word-start matching reads. */
export const MENTION_MAX_MATCH_WORDS = 64;
/** The tier of a server item whose title or name does not match: T4, or after C3 for people. */
export const MENTION_UNMATCHED_SERVER_TIER = 4;
/** `adaptive` is in millionths: 1,000,000 is pick memory's full score. */
export const MENTION_PICK_SCALE = 1_000_000;

/** T0 exact, T1 prefix, T2 word start (or CJK contains), T3 substring; C0 to C3 for people. */
export type MentionTier = 0 | 1 | 2 | 3;

/** How a section's candidates are tiered: objects by title, people by name and address. */
export type MentionRankLane = 'objects' | 'people';

/** A typed query, prepared once per keystroke. */
export interface MentionQuery {
  /** The normalized query, at most 512 code points of it; empty for a bare `@`. */
  readonly normalized: string;
  /** Its words, at most one past {@link MENTION_MAX_MATCH_TOKENS}, which marks an overflow. */
  readonly tokens: readonly string[];
  /** Whether any code point is Han, kana or Hangul. */
  readonly hasCjk: boolean;
  /** Code points of {@link normalized}. */
  readonly codePoints: number;
}

/** One item of a section as the client ranks it (the contract's `rank::Candidate`). */
export interface MentionRankCandidate {
  /** The navigation key ({@link mentionItemNavKey}): the item's identity and the last tie-break. */
  readonly key: string;
  /** The title of a page, database or row; a person's name, which may be blank. */
  readonly title: string;
  /** A person's address; empty or absent for objects. */
  readonly email?: string;
  /** Pick memory's `adaptive` for the typed input, in millionths ({@link MENTION_PICK_SCALE}). */
  readonly adaptive?: number;
  /** Pick memory for exactly the typed input lifts the item one tier, never more. */
  readonly lift?: boolean;
  /** The object is already mentioned on the open page, or the person takes part in it. */
  readonly present?: boolean;
  /** When this client last opened, created or mentioned the item, in epoch milliseconds. */
  readonly lastUsedMs?: number;
  /** The item's position in the server's section; absent for a local-only item. */
  readonly serverRank?: number;
  /** The person is the requester, who comes last in their tier. */
  readonly requester?: boolean;
}

/** The client's own signals for a server item, which {@link retierServerSection} ranks with. */
export type MentionRankSignals = Pick<
  MentionRankCandidate,
  'adaptive' | 'lift' | 'present' | 'lastUsedMs' | 'requester'
>;

/** How recently the client used an item: within 15 minutes, an hour, a day, older, or never. */
export enum MentionRecencyBucket {
  Within15Minutes = 0,
  WithinHour = 1,
  WithinDay = 2,
  Older = 3,
  Never = 4,
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The bucket of an item last used at `lastUsedMs`. Bounds are inclusive, and a time ahead of
 * `nowMs`, from a clock that stepped back, counts as now.
 */
export function mentionRecencyBucket(nowMs: number, lastUsedMs: number | undefined): MentionRecencyBucket {
  if (lastUsedMs === undefined || Number.isNaN(lastUsedMs)) return MentionRecencyBucket.Never;

  const age = Math.max(0, nowMs - lastUsedMs);

  if (age <= 15 * MINUTE_MS) return MentionRecencyBucket.Within15Minutes;
  if (age <= HOUR_MS) return MentionRecencyBucket.WithinHour;
  if (age <= DAY_MS) return MentionRecencyBucket.WithinDay;
  return MentionRecencyBucket.Older;
}

/** Han, kana and Hangul. NFKD turns Hangul syllables into conjoining Jamo, so Jamo count too. */
export function isMentionCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3130 && codePoint <= 0x318f) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xd7b0 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  );
}

function containsCjk(text: string): boolean {
  for (const char of text) {
    if (isMentionCjk(char.codePointAt(0) ?? 0)) return true;
  }

  return false;
}

/** Anything but Unicode Alphabetic and Numeric (Nd, Nl, No): Rust's `!char::is_alphanumeric`. */
const NON_WORD = /[^\p{Alphabetic}\p{N}]+/u;

/** The maximal alphanumeric runs of normalized text, at most `max`. A CJK run is one word. */
export function mentionWords(normalized: string, max = Number.POSITIVE_INFINITY): string[] {
  const words: string[] = [];

  for (const word of normalized.split(NON_WORD)) {
    if (words.length >= max) break;
    if (word) words.push(word);
  }

  return words;
}

/** Prepares a typed query: normalized, split into tokens and checked for CJK. */
export function prepareMentionQuery(raw: string): MentionQuery {
  const normalized = normalizeMentionText(boundMentionText(raw));

  return {
    normalized,
    // One token past the bound is enough to know word-start matching does not apply.
    tokens: mentionWords(normalized, MENTION_MAX_MATCH_TOKENS + 1),
    hasCjk: containsCjk(normalized),
    codePoints: countCodePoints(normalized),
  };
}

/**
 * The pass prepared texts are read in ({@link PreparedCache}), and the normalized query that began
 * it: every ranking of one typed query is one pass.
 */
let rankPass = 0;
let rankPassQuery = '';

/** `query`, prepared; a typed query unlike the one before begins a pass. */
function rankingQuery(query: MentionQuery | string): MentionQuery {
  const prepared = typeof query === 'string' ? prepareMentionQuery(query) : query;

  if (prepared.normalized && prepared.normalized !== rankPassQuery) {
    rankPass += 1;
    rankPassQuery = prepared.normalized;
  }

  return prepared;
}

/**
 * Whether every token starts a different word, as a bipartite matching found with Kuhn's
 * augmenting paths, exactly as the Rust reference does it: no assignment for an empty query or
 * more than {@link MENTION_MAX_MATCH_TOKENS} tokens, only the first {@link MENTION_MAX_MATCH_WORDS}
 * words take part, and `steps` counts the candidate words examined, at most tokens² × words.
 */
export function assignMentionTokens(
  tokens: readonly string[],
  words: readonly string[]
): { matched: boolean; steps: number } {
  const wordCount = Math.min(words.length, MENTION_MAX_MATCH_WORDS);
  let steps = 0;

  if (tokens.length === 0 || tokens.length > MENTION_MAX_MATCH_TOKENS || tokens.length > wordCount) {
    return { matched: false, steps };
  }

  // For each token, the words it starts.
  const candidates = tokens.map((token) => {
    const starts: number[] = [];

    for (let word = 0; word < wordCount; word += 1) {
      if (words[word].startsWith(token)) starts.push(word);
    }

    return starts;
  });

  if (candidates.some((starts) => starts.length === 0)) return { matched: false, steps };

  // For each word, the token it is assigned to, or -1.
  const owners = new Int32Array(wordCount).fill(-1);
  const visited = new Uint8Array(wordCount);
  // Gives `token` a word, moving earlier tokens to other words when needed; each word is visited
  // at most once per round, and the recursion is at most as deep as the number of tokens.
  const assign = (token: number): boolean => {
    for (const word of candidates[token]) {
      steps += 1;
      if (visited[word]) continue;
      visited[word] = 1;

      const owner = owners[word];

      if (owner === -1 || assign(owner)) {
        owners[word] = token;
        return true;
      }
    }

    return false;
  };

  for (let token = 0; token < tokens.length; token += 1) {
    visited.fill(0);
    if (!assign(token)) return { matched: false, steps };
  }

  return { matched: true, steps };
}

/**
 * {@link assignMentionTokens}'s answer, with shortcuts for the common cases. `text` is the text the
 * words come from.
 */
export function mentionTokensStartDistinctWords(
  tokens: readonly string[],
  words: readonly string[],
  text: string
): boolean {
  const wordCount = Math.min(words.length, MENTION_MAX_MATCH_WORDS);

  if (tokens.length === 0 || tokens.length > MENTION_MAX_MATCH_TOKENS || tokens.length > wordCount) return false;

  // A word that starts with a token contains it, so a token missing from the text matches no word.
  for (const token of tokens) {
    if (!text.includes(token)) return false;
  }

  if (tokens.length > 1) return assignMentionTokens(tokens, words).matched;

  for (let word = 0; word < wordCount; word += 1) {
    if (words[word].startsWith(tokens[0])) return true;
  }

  return false;
}

/** When a cached text was last read, which decides what a sweep keeps. */
interface PreparedReads {
  /** The pass of the latest read. */
  pass: number;
  /** How many sweeps its cache had made at the latest read. */
  sweep: number;
}

/** A title or name, prepared once for matching and ranking. */
interface PreparedText extends PreparedReads {
  /** The normalized first 512 code points. */
  readonly normalized: string;
  /** Their first {@link MENTION_MAX_MATCH_WORDS} words. */
  readonly words: readonly string[];
  /** Code points of the text as written: its length when it is shown. */
  readonly codePoints: number;
  /** Only Unicode White_Space: a person's name that is shown as their address. */
  readonly blank: boolean;
}

/** An address, prepared once; the local part is everything before the first `@`. */
interface PreparedAddress extends PreparedReads {
  readonly normalized: string;
  readonly local: string;
  readonly localWords: readonly string[];
  readonly codePoints: number;
}

/** A cache holds at least this many texts before it first sweeps. */
const PREPARED_MIN_CAPACITY = 10_000;
/**
 * Texts longer than this many UTF-16 units are prepared on every read instead. V8 hashes a string
 * longer than 16,383 units by its length only, so equal-length long titles would share one hash
 * and every lookup would compare whole strings, a cost that grows with the square of their
 * number. Uncached, such a title costs reading its first 512 code points and counting the rest,
 * linear in its length, as in the Rust reference.
 */
const PREPARED_MAX_KEY_LENGTH = 2048;

/**
 * Prepared texts, each kept by its own string. Reads are counted in passes ({@link rankingQuery}):
 * every ranking of one typed query is one pass, so a keystroke that ranks each of its sections
 * with its query reads all of them in one pass, however many sections there are and however the
 * candidates are split between them.
 *
 * A full cache does not forget its oldest text, which for texts read in the same order on every
 * keystroke is the next one read; it sweeps. A sweep keeps every text read since the previous
 * sweep or in the current or previous pass, then makes room for half as many new texts as those
 * two passes read, and at least half {@link PREPARED_MIN_CAPACITY}. So the texts keystrokes keep
 * ranking are prepared once, whatever their number; a text nothing reads any more (a renamed
 * title, a past server answer, another workspace) goes at a later sweep; and since the room
 * follows what recent passes read, not what the sweep kept, the cache does not grow with the time
 * the picker is used.
 */
class PreparedCache<T extends PreparedReads> {
  private readonly entries = new Map<string, T>();
  private capacity = PREPARED_MIN_CAPACITY;
  private sweeps = 0;

  constructor(private readonly prepare: (text: string) => T) {}

  read(text: string): T {
    if (text.length > PREPARED_MAX_KEY_LENGTH) return this.prepare(text);

    let entry = this.entries.get(text);

    if (!entry) {
      if (this.entries.size >= this.capacity) this.sweep();
      entry = this.prepare(text);
      this.entries.set(text, entry);
    }

    entry.pass = rankPass;
    entry.sweep = this.sweeps;
    return entry;
  }

  clear(): void {
    this.entries.clear();
    this.capacity = PREPARED_MIN_CAPACITY;
    this.sweeps = 0;
  }

  private sweep(): void {
    let recent = 0;

    for (const [text, entry] of this.entries) {
      if (entry.pass >= rankPass - 1) recent += 1;
      else if (entry.sweep < this.sweeps) this.entries.delete(text);
    }

    this.sweeps += 1;
    this.capacity = Math.max(PREPARED_MIN_CAPACITY, this.entries.size + Math.max(recent / 2, PREPARED_MIN_CAPACITY / 2));
  }
}

const preparedTexts = new PreparedCache<PreparedText>((text) => {
  const normalized = normalizeMentionText(boundMentionText(text));

  return {
    normalized,
    words: mentionWords(normalized, MENTION_MAX_MATCH_WORDS),
    codePoints: countCodePoints(text),
    blank: isMentionBlankText(text),
    pass: 0,
    sweep: 0,
  };
});

const preparedAddresses = new PreparedCache<PreparedAddress>((address) => {
  const normalized = normalizeMentionText(boundMentionText(address));
  const at = normalized.indexOf('@');
  const local = at === -1 ? normalized : normalized.slice(0, at);

  return {
    normalized,
    local,
    localWords: mentionWords(local, MENTION_MAX_MATCH_WORDS),
    codePoints: countCodePoints(address),
    pass: 0,
    sweep: 0,
  };
});

/**
 * Prepares the titles, names and addresses of `candidates` ahead of the first keystroke, for
 * example when the picker opens on a new local snapshot, so that keystroke only compares. Each
 * section's candidates can be prepared on their own: they stay as long as keystrokes rank them.
 */
export function prepareMentionRankCandidates(
  candidates: readonly Pick<MentionRankCandidate, 'title' | 'email'>[]
): void {
  for (const candidate of candidates) {
    preparedTexts.read(candidate.title);
    if (candidate.email) preparedAddresses.read(candidate.email);
  }
}

/** Forgets every prepared title, name and address. */
export function clearMentionRankerCache(): void {
  preparedTexts.clear();
  preparedAddresses.clear();
  rankPass = 0;
  rankPassQuery = '';
}

function titleTier(query: MentionQuery, title: PreparedText): MentionTier | undefined {
  const text = title.normalized;

  if (text === query.normalized) return 0;
  if (text.startsWith(query.normalized)) return 1;
  if (query.hasCjk && text.includes(query.normalized)) return 2;
  if (mentionTokensStartDistinctWords(query.tokens, title.words, text)) return 2;
  if (!query.hasCjk && query.codePoints >= 2 && text.includes(query.normalized)) return 3;
  return undefined;
}

function personClass(query: MentionQuery, name: PreparedText, address: PreparedAddress): MentionTier | undefined {
  if (
    mentionTokensStartDistinctWords(query.tokens, name.words, name.normalized) ||
    (query.hasCjk && name.normalized.includes(query.normalized)) ||
    address.local.startsWith(query.normalized) ||
    mentionTokensStartDistinctWords(query.tokens, address.localWords, address.local)
  ) {
    return 0;
  }

  if (name.normalized.includes(query.normalized)) return 1;
  if (address.local.includes(query.normalized)) return 2;
  if (
    query.tokens.length > 0 &&
    (query.normalized.includes('@') || query.normalized.includes('.')) &&
    address.normalized.includes(query.normalized)
  ) {
    return 3;
  }

  return undefined;
}

/**
 * The title tier of a page, database or row, or `undefined` when the title does not match (or the
 * query is bare): T0 the title is the query, T1 it starts with it, T2 a CJK query it contains or
 * every token starting a different title word, T3 a non-CJK query of at least two code points it
 * contains. `mention_match::title_tier`, pinned by `mention-parity/tiers.json`.
 */
export function objectTier(query: MentionQuery | string, title: string): MentionTier | undefined {
  const prepared = rankingQuery(query);

  return prepared.normalized ? titleTier(prepared, preparedTexts.read(title)) : undefined;
}

/**
 * A person's class, or `undefined`: C0 every token starting a different name word, a CJK query
 * the name contains, or an address local part that starts with the query or whose words the
 * tokens start; C1 the name contains the query; C2 the local part does; C3 a query with a letter
 * or digit and an `@` or `.` that the full address contains. The domain alone never matches.
 * `mention_match::person_match_class`, pinned by `mention-parity/people.json`.
 */
export function personTier(query: MentionQuery | string, name: string, email: string): MentionTier | undefined {
  const prepared = rankingQuery(query);

  return prepared.normalized
    ? personClass(prepared, preparedTexts.read(name), preparedAddresses.read(email))
    : undefined;
}

/** A candidate's place in its section: the fields after `candidate` are the sort keys, in order. */
export interface MentionRankEntry<C extends MentionRankCandidate = MentionRankCandidate> {
  readonly candidate: C;
  /** The tier after a pick-memory lift; {@link MENTION_UNMATCHED_SERVER_TIER} for an unmatched server item. */
  readonly tier: number;
  readonly requester: boolean;
  readonly adaptive: number;
  readonly present: boolean;
  readonly recency: MentionRecencyBucket;
  /** Server items in server order, then local-only items. */
  readonly serverRank: number | undefined;
  /** Code points of the text the picker shows: the title, or a blank-named person's address. */
  readonly length: number;
  /** The navigation key in a form whose UTF-16 order is the key's code point order. */
  readonly keyOrder: string;
}

/**
 * A candidate's rank entry, or `undefined` when it is dropped: a local-only candidate must match its
 * title or name, while a server candidate that does not keeps the last tier, because the server
 * matched it elsewhere (its body, a typo, an older title). A lift raises the tier by one.
 */
export function mentionRankEntry<C extends MentionRankCandidate>(
  query: MentionQuery | string,
  lane: MentionRankLane,
  candidate: C,
  nowMs: number
): MentionRankEntry<C> | undefined {
  const prepared = rankingQuery(query);
  const title = preparedTexts.read(candidate.title);
  const email = candidate.email ?? '';
  const address = lane === 'people' || (title.blank && email) ? preparedAddresses.read(email) : undefined;
  let tier: number | undefined;

  if (prepared.normalized) {
    tier = lane === 'people' && address ? personClass(prepared, title, address) : titleTier(prepared, title);
  }

  if (tier === undefined) {
    if (candidate.serverRank === undefined) return undefined;
    tier = MENTION_UNMATCHED_SERVER_TIER;
  }

  return {
    candidate,
    tier: candidate.lift ? Math.max(0, tier - 1) : tier,
    requester: Boolean(candidate.requester),
    adaptive: candidate.adaptive ?? 0,
    present: Boolean(candidate.present),
    recency: mentionRecencyBucket(nowMs, candidate.lastUsedMs),
    serverRank: candidate.serverRank,
    length: title.blank && address && email ? address.codePoints : title.codePoints,
    keyOrder: codePointOrderKey(candidate.key),
  };
}

/**
 * The contract's in-tier order after the tier: the requester last, pick memory (`adaptive`)
 * descending, present first, recency bucket, server items in server order before local-only items,
 * fewer code points, then the navigation key by code point. The key makes the order total.
 */
export function compareMentionRankEntries(a: MentionRankEntry, b: MentionRankEntry): number {
  return (
    a.tier - b.tier ||
    Number(a.requester) - Number(b.requester) ||
    b.adaptive - a.adaptive ||
    Number(b.present) - Number(a.present) ||
    a.recency - b.recency ||
    Number(a.serverRank === undefined) - Number(b.serverRank === undefined) ||
    (a.serverRank ?? 0) - (b.serverRank ?? 0) ||
    a.length - b.length ||
    compareCodeUnits(a.keyOrder, b.keyOrder)
  );
}

/**
 * The best `limit` candidates of one section, best first (`mention_typeahead::rank_section`, pinned
 * by `mention-parity/rank.json`): ranked by {@link compareMentionRankEntries} before truncating, a
 * key that appears twice keeps its better place, and the order never depends on the input order. A
 * query that normalizes to nothing (a bare `@`) keeps the server's order and drops local-only
 * candidates.
 */
export function rankSection<C extends MentionRankCandidate>(
  query: MentionQuery | string,
  lane: MentionRankLane,
  candidates: readonly C[],
  nowMs: number,
  limit = Number.POSITIVE_INFINITY
): C[] {
  const prepared = rankingQuery(query);
  const seen = new Set<string>();
  const ranked: C[] = [];
  const keep = (candidate: C) => {
    if (ranked.length >= limit || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    ranked.push(candidate);
  };

  if (!prepared.normalized) {
    candidates
      .filter((candidate) => candidate.serverRank !== undefined)
      .sort((a, b) => (a.serverRank ?? 0) - (b.serverRank ?? 0) || compareCodePoints(a.key, b.key))
      .forEach(keep);
    return ranked;
  }

  // The tier is the first key, so only the tiers that fill the limit need sorting: a one-letter
  // query can match thousands of local titles, of which 20 are shown.
  const tiers: MentionRankEntry<C>[][] = [];

  for (const candidate of candidates) {
    const entry = mentionRankEntry(prepared, lane, candidate, nowMs);

    if (entry) (tiers[entry.tier] ??= []).push(entry);
  }

  for (const entries of tiers) {
    if (ranked.length >= limit) break;
    if (!entries) continue;
    entries.sort(compareMentionRankEntries);
    for (const entry of entries) {
      if (ranked.length >= limit) break;
      keep(entry.candidate);
    }
  }

  return ranked;
}

/** The lane a section ranks in; Suggested, Dates and Links keep the server's order. */
export function mentionSectionRankLane(kind: MentionSearchSectionKind): MentionRankLane | undefined {
  switch (kind) {
    case MentionSearchSectionKind.People:
      return 'people';
    case MentionSearchSectionKind.Pages:
    case MentionSearchSectionKind.Databases:
    case MentionSearchSectionKind.DatabaseRows:
      return 'objects';
    default:
      return undefined;
  }
}

/** A server item as a rank candidate, which carries the item back. */
export interface MentionServerRankCandidate extends MentionRankCandidate {
  readonly item: MentionSearchResultItem;
}

/**
 * A server item at `serverRank` as a candidate. Cloud sends a person's address as the subtitle and
 * titles a person whose name is blank by that address, so a title equal to the subtitle is a blank
 * name: the domain then never matches as a name.
 */
export function mentionServerCandidate(
  item: MentionSearchResultItem,
  serverRank: number,
  signals?: MentionRankSignals
): MentionServerRankCandidate {
  const email = item.kind === MentionTargetKind.Person ? item.subtitle ?? '' : '';

  return {
    ...signals,
    key: mentionItemNavKey(item),
    title: item.kind === MentionTargetKind.Person && item.title === email ? '' : item.title,
    email,
    serverRank,
    item,
  };
}

export interface RetierServerSectionOptions {
  /** The clock for recency buckets, in epoch milliseconds; `Date.now()` by default. */
  nowMs?: number;
  /** The client's signals for an item, by its navigation key. */
  signals?: (key: string, item: MentionSearchResultItem) => MentionRankSignals | undefined;
}

/**
 * A server section re-tiered by the client: People, Pages, Databases and Database rows are ranked
 * with {@link rankSection}, so an item whose title or name does not match the query (a body hit, a
 * typo, an older title) moves below every title match, in any server's answer. Inside a tier the
 * server's order holds unless the client's own signals say otherwise. Other sections, and a bare
 * `@`, keep the server's order. An item the section lists twice keeps its better place. The
 * section comes back as it was when nothing moves.
 */
export function retierServerSection(
  query: MentionQuery | string,
  section: MentionSearchSection,
  options: RetierServerSectionOptions = {}
): MentionSearchSection {
  const lane = mentionSectionRankLane(section.kind);

  if (!lane) return section;

  const { nowMs = Date.now(), signals } = options;
  const candidates = section.items.map((item, index) =>
    mentionServerCandidate(item, index, signals?.(mentionItemNavKey(item), item))
  );
  const items = rankSection(query, lane, candidates, nowMs).map((candidate) => candidate.item);

  return items.length === section.items.length && items.every((item, index) => item === section.items[index])
    ? section
    : { ...section, items };
}
