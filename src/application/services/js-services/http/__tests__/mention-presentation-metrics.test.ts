import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';

import type { ServerInfoState } from '@/utils/server-info';

import type { ServerInfo } from '../auth-api';
import { getAxios } from '../core';
import {
  MENTION_FEATURE_SESSION_METRICS_V1,
  MENTION_SESSION_MAX_MS,
  MENTION_SESSION_MAX_RANK,
  MENTION_SESSION_MAX_REQUESTS,
  MentionPickerSession,
  mentionPickerSessionPayload,
  mentionSessionMetricsEnabled,
  reportMentionPickerSession,
  resetMentionSessionMetricsForTests,
} from '../mention-presentation-metrics';

jest.mock('../core', () => ({ getAxios: jest.fn() }));

function advertising(mentionFeatures?: unknown): ServerInfoState {
  return {
    status: 'available',
    info: { enable_page_history: true, mention_features: mentionFeatures } as ServerInfo,
  };
}

const ADVERTISED = advertising([MENTION_FEATURE_SESSION_METRICS_V1]);

// The session Cloud pins in `mention_dto/session_report.rs` (`the_wire_names_are_pinned`).
const selected: MentionPickerSession = {
  trigger: 'at',
  outcome: 'selected',
  query_len: 3,
  selected_rank: 2,
  selected_section: 'pages',
  selected_source: 'server',
  selected_tier: 'prefix',
  time_to_first_paint_ms: 40,
  time_to_select_ms: 1_800,
  server_ms: 120,
  requests_sent: 4,
  requests_aborted: 2,
  zero_result_shown: false,
};

function mockPost(post: jest.Mock) {
  jest.mocked(getAxios).mockReturnValue({ post } as never);
}

function httpError(status: number) {
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: String(status),
    data: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse);
}

const ALLOWED_LABELS: Record<string, readonly string[]> = {
  client: ['web'],
  trigger: ['at', 'plus', 'page_link'],
  outcome: ['selected', 'dismissed', 'error'],
  selected_section: ['suggested', 'people', 'pages', 'databases', 'database_rows', 'dates', 'links'],
  selected_source: ['server', 'cache', 'local'],
  selected_tier: ['exact', 'prefix', 'word_start', 'substring', 'body'],
};
const NUMBER_FIELDS = [
  'query_len',
  'selected_rank',
  'time_to_first_paint_ms',
  'time_to_select_ms',
  'server_ms',
  'requests_sent',
  'requests_aborted',
];

/** Fails unless every key is a report field and every value a whole number, a boolean or an allowed label. */
function expectOnlyAllowedValues(payload: object) {
  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'zero_result_shown') {
      expect(typeof value).toBe('boolean');
    } else if (NUMBER_FIELDS.includes(key)) {
      expect(Number.isInteger(value)).toBe(true);
    } else {
      expect(ALLOWED_LABELS[key]).toBeDefined();
      expect(ALLOWED_LABELS[key]).toContain(value);
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMentionSessionMetricsForTests();
});

describe('reportMentionPickerSession', () => {
  it('sends one short single-attempt POST, without a signal, to the workspace mention route', async () => {
    const post = jest.fn().mockResolvedValue({ status: 204, data: '' });

    mockPost(post);
    await expect(reportMentionPickerSession('workspace/id', selected, ADVERTISED)).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/api/workspace/workspace%2Fid/mentions/metrics',
      { client: 'web', ...selected },
      { timeout: 3_000, skipTransportRetry: true, skipAuthRefresh: true }
    );
    expect(post.mock.calls[0][2]).not.toHaveProperty('signal');
  });

  it.each<[string, ServerInfoState]>([
    ['loading', { status: 'loading' }],
    ['unavailable', { status: 'unavailable' }],
    ['unsupported (an older server without server-info)', { status: 'unsupported' }],
    ['available without mention_features (an older server)', advertising(undefined)],
    ['available with no mention feature', advertising([])],
    ['available with other mention features', advertising(['section_degradation_v1'])],
    ['available with a malformed mention_features', advertising('session_metrics_v1')],
  ])('sends nothing when server info is %s', async (_name, serverInfo) => {
    const post = jest.fn().mockResolvedValue({ status: 204 });

    mockPost(post);
    expect(mentionSessionMetricsEnabled(serverInfo)).toBe(false);
    await expect(reportMentionPickerSession('workspace', selected, serverInfo)).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();
  });

  it('reads the app server-info snapshot by default, which is loading until the auth layer loads it', async () => {
    const post = jest.fn().mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPickerSession('workspace', selected)).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows failures and a missing API client or workspace', async () => {
    const post = jest.fn().mockRejectedValue(new Error('unavailable'));

    mockPost(post);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('failed');
    expect(post).toHaveBeenCalledTimes(1);

    await expect(reportMentionPickerSession('', selected, ADVERTISED)).resolves.toBe('skipped');
    await expect(reportMentionPickerSession(undefined, selected, ADVERTISED)).resolves.toBe('skipped');
    expect(post).toHaveBeenCalledTimes(1);

    jest.mocked(getAxios).mockReturnValue(undefined as never);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('skipped');
  });

  it('sends nothing more in this tab once the route answered 404, as after a rollback', async () => {
    const post = jest.fn().mockRejectedValueOnce(httpError(404)).mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('failed');
    expect(mentionSessionMetricsEnabled(ADVERTISED)).toBe(false);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('skipped');
    await expect(reportMentionPickerSession('other-workspace', selected, ADVERTISED)).resolves.toBe('skipped');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 500', httpError(500)],
    ['a 401', httpError(401)],
    ['a network error', new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('keeps reporting after %s', async (_name, error) => {
    const post = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('failed');
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('tells a refusal inside HTTP 200 from success, and keeps reporting after it', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { code: 1012, message: 'not enough permissions' } })
      .mockResolvedValue({ status: 200, data: { code: 0, message: 'success' } });

    mockPost(post);
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('refused');
    await expect(reportMentionPickerSession('workspace', selected, ADVERTISED)).resolves.toBe('sent');
  });
});

describe('mentionPickerSessionPayload', () => {
  it('uses the wire names Cloud pins for a selected session', () => {
    expect(JSON.parse(JSON.stringify(mentionPickerSessionPayload(selected)))).toEqual({
      client: 'web',
      trigger: 'at',
      outcome: 'selected',
      query_len: 3,
      selected_rank: 2,
      selected_section: 'pages',
      selected_source: 'server',
      selected_tier: 'prefix',
      time_to_first_paint_ms: 40,
      time_to_select_ms: 1800,
      server_ms: 120,
      requests_sent: 4,
      requests_aborted: 2,
      zero_result_shown: false,
    });
  });

  it('sends the selection fields only for a selection', () => {
    expect(mentionPickerSessionPayload({ ...selected, outcome: 'dismissed' })).toEqual({
      client: 'web',
      trigger: 'at',
      outcome: 'dismissed',
      query_len: 3,
      time_to_first_paint_ms: 40,
      server_ms: 120,
      requests_sent: 4,
      requests_aborted: 2,
      zero_result_shown: false,
    });
  });

  it('copies only report fields and allowed labels, so no query text or id leaves the tab', () => {
    const leaky = {
      ...selected,
      trigger: 'page_link',
      selected_section: 'a section from a newer picker',
      selected_source: '0f7c5c2e-1d4b-4d8e-9a3e-2b6f2f9a1c11',
      selected_tier: 'roadmap',
      query: 'roadmap',
      object_id: '0f7c5c2e-1d4b-4d8e-9a3e-2b6f2f9a1c11',
      workspace_id: 'workspace',
      title: 'Roadmap',
    } as unknown as MentionPickerSession;
    const payload = mentionPickerSessionPayload(leaky);

    expect(payload).toBeDefined();
    expectOnlyAllowedValues(payload as object);
    expect(Object.keys(payload as object).sort()).toEqual(
      [
        'client',
        'trigger',
        'outcome',
        'query_len',
        'selected_rank',
        'time_to_first_paint_ms',
        'time_to_select_ms',
        'server_ms',
        'requests_sent',
        'requests_aborted',
        'zero_result_shown',
      ].sort()
    );
    expect(JSON.stringify(payload)).not.toMatch(/roadmap|0f7c5c2e|workspace/i);
  });

  it.each([
    ['an unknown trigger', { trigger: 'brackets' }],
    ['a slash-menu trigger', { trigger: 'slash' }],
    ['an unknown outcome', { outcome: 'closed' }],
  ])('reports nothing for %s, which Cloud has no label for', (_name, change) => {
    expect(mentionPickerSessionPayload({ ...selected, ...change } as unknown as MentionPickerSession)).toBeUndefined();
  });

  it('sends whole numbers within the bounds Cloud accepts, and leaves out impossible durations and ranks', () => {
    const payload = mentionPickerSessionPayload({
      ...selected,
      query_len: 12.6,
      selected_rank: MENTION_SESSION_MAX_RANK + 1,
      time_to_first_paint_ms: 12.5,
      time_to_select_ms: MENTION_SESSION_MAX_MS + 1,
      server_ms: -3,
      requests_sent: MENTION_SESSION_MAX_REQUESTS + 40,
      requests_aborted: MENTION_SESSION_MAX_REQUESTS + 41,
    });

    expect(payload).toEqual({
      client: 'web',
      trigger: 'at',
      outcome: 'selected',
      query_len: 13,
      selected_section: 'pages',
      selected_source: 'server',
      selected_tier: 'prefix',
      time_to_first_paint_ms: 13,
      requests_sent: MENTION_SESSION_MAX_REQUESTS,
      requests_aborted: MENTION_SESSION_MAX_REQUESTS,
      zero_result_shown: false,
    });
    expectOnlyAllowedValues(payload as object);
  });

  it.each([0, 2.5, Number.NaN])('leaves out the rank %p', (rank) => {
    expect(mentionPickerSessionPayload({ ...selected, selected_rank: rank })).not.toHaveProperty('selected_rank');
  });

  it('keeps the bounds themselves, and never reports more aborted than sent requests', () => {
    expect(
      mentionPickerSessionPayload({
        ...selected,
        selected_rank: MENTION_SESSION_MAX_RANK,
        time_to_first_paint_ms: 0,
        time_to_select_ms: MENTION_SESSION_MAX_MS,
        requests_sent: 2,
        requests_aborted: 5,
      })
    ).toMatchObject({
      selected_rank: MENTION_SESSION_MAX_RANK,
      time_to_first_paint_ms: 0,
      time_to_select_ms: MENTION_SESSION_MAX_MS,
      requests_sent: 2,
      requests_aborted: 2,
    });
  });
});
