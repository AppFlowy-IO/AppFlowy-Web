import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';

import { MentionTargetKind } from '@/application/types';
import type { ServerInfoState } from '@/utils/server-info';

import type { ServerInfo } from '../auth-api';
import { getAxios } from '../core';
import {
  MENTION_FEATURE_SELECTION_MEMORY_V1,
  MENTION_PICK_MAX_POSITION,
  MentionPick,
  mentionPickFeedbackEnabled,
  mentionPickFeedbackPayload,
  reportMentionPick,
  resetMentionPickFeedbackForTests,
} from '../mention-pick-feedback';

jest.mock('../core', () => ({ getAxios: jest.fn() }));

function advertising(mentionFeatures?: unknown): ServerInfoState {
  return {
    status: 'available',
    info: { enable_page_history: true, mention_features: mentionFeatures } as ServerInfo,
  };
}

const ADVERTISED = advertising([MENTION_FEATURE_SELECTION_MEMORY_V1]);
const PAGE_ID = '9a6f0a54-2f1e-4f3e-9d43-7f5a0c1d2e3f';
const pagePick: MentionPick = { item: { kind: MentionTargetKind.Page, object_id: PAGE_ID }, position: 2, query: 'roa' };

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

beforeEach(() => {
  jest.clearAllMocks();
  resetMentionPickFeedbackForTests();
});

describe('reportMentionPick (MEN-WEB-11)', () => {
  it('sends one short single-attempt POST to the workspace feedback route, with the names Cloud pins', async () => {
    const post = jest.fn().mockResolvedValue({ status: 204, data: '' });

    mockPost(post);
    await expect(reportMentionPick('workspace/id', pagePick, ADVERTISED)).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(1);
    // Cloud's `the_wire_names_are_pinned`, without the request id this client cannot read.
    expect(post).toHaveBeenCalledWith(
      '/api/workspace/workspace%2Fid/mentions/feedback',
      { target_kind: 'page', target_id: PAGE_ID, position: 2, query_len: 3 },
      { timeout: 3_000, skipTransportRetry: true, skipAuthRefresh: true }
    );
    expect(post.mock.calls[0][2]).not.toHaveProperty('signal');
  });

  it.each<[string, ServerInfoState]>([
    ['loading', { status: 'loading' }],
    ['unavailable', { status: 'unavailable' }],
    ['unsupported (an older server without server-info)', { status: 'unsupported' }],
    ['available without mention_features (an older server)', advertising(undefined)],
    ['available with other mention features (a self-hosted or flag-off server)', advertising(['session_metrics_v1'])],
    ['available with a malformed mention_features', advertising('selection_memory_v1')],
  ])('sends nothing when server info is %s', async (_name, serverInfo) => {
    const post = jest.fn().mockResolvedValue({ status: 204 });

    mockPost(post);
    expect(mentionPickFeedbackEnabled(serverInfo)).toBe(false);
    await expect(reportMentionPick('workspace', pagePick, serverInfo)).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();
  });

  it('reads the app server-info snapshot by default, which is loading until the auth layer loads it', async () => {
    const post = jest.fn().mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPick('workspace', pagePick)).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores a 404, and sends nothing more in this tab after it, as after a rollback', async () => {
    const post = jest.fn().mockRejectedValueOnce(httpError(404)).mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('failed');
    expect(mentionPickFeedbackEnabled(ADVERTISED)).toBe(false);
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('skipped');
    await expect(reportMentionPick('other-workspace', pagePick, ADVERTISED)).resolves.toBe('skipped');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 500', httpError(500)],
    ['a 401', httpError(401)],
    ['a 429', httpError(429)],
    ['a network error', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['a timeout', new AxiosError('timeout of 3000ms exceeded', 'ECONNABORTED')],
    ['a plain error', new Error('unavailable')],
  ])('swallows %s and keeps reporting after it', async (_name, error) => {
    const post = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('failed');
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('never rejects, even when the API client itself throws', async () => {
    jest.mocked(getAxios).mockImplementation(() => {
      throw new Error('not initialized');
    });
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('failed');
  });

  it('tells a refusal inside HTTP 200 from success, and keeps reporting after it', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { code: 1012, message: 'not enough permissions' } })
      .mockResolvedValue({ status: 204, data: '' });

    mockPost(post);
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('refused');
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('sent');
  });

  it('sends nothing without a workspace, an API client or an object the pick can name', async () => {
    const post = jest.fn().mockResolvedValue({ status: 204 });

    mockPost(post);
    await expect(reportMentionPick('', pagePick, ADVERTISED)).resolves.toBe('skipped');
    await expect(reportMentionPick(undefined, pagePick, ADVERTISED)).resolves.toBe('skipped');
    await expect(
      reportMentionPick(
        'workspace',
        { ...pagePick, item: { kind: MentionTargetKind.Date, object_id: 'today' } },
        ADVERTISED
      )
    ).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();

    jest.mocked(getAxios).mockReturnValue(undefined as never);
    await expect(reportMentionPick('workspace', pagePick, ADVERTISED)).resolves.toBe('skipped');
  });
});

describe('mentionPickFeedbackPayload', () => {
  it.each([
    [MentionTargetKind.Person, 'person'],
    [MentionTargetKind.Page, 'page'],
    [MentionTargetKind.Database, 'database'],
    [MentionTargetKind.DatabaseRow, 'database_row'],
  ])('names a %s by its object id', (kind, wire) => {
    expect(mentionPickFeedbackPayload({ item: { kind, object_id: PAGE_ID }, query: '' })).toEqual({
      target_kind: wire,
      target_id: PAGE_ID,
      query_len: 0,
    });
  });

  it.each([
    ['a date', { kind: MentionTargetKind.Date, object_id: 'today' }],
    ['a reminder', { kind: MentionTargetKind.Reminder, object_id: PAGE_ID }],
    ['a link', { kind: MentionTargetKind.ExternalLink, object_id: PAGE_ID }],
    ['a kind from a newer server', { kind: 'whiteboard' as MentionTargetKind, object_id: PAGE_ID }],
    ['an item without an id', { kind: MentionTargetKind.Page }],
    ['an id that is no UUID', { kind: MentionTargetKind.Page, object_id: 'Roadmap' }],
  ])('names nothing for %s', (_name, item) => {
    expect(mentionPickFeedbackPayload({ item, query: 'road' })).toBeUndefined();
  });

  it('carries only the length of the query, counted as Cloud counts the query it joins the pick to', () => {
    const payload = mentionPickFeedbackPayload({ ...pagePick, query: '  Road   Trip  ' });

    // Trimmed, with white space collapsed: "road trip".
    expect(payload).toEqual({ target_kind: 'page', target_id: PAGE_ID, position: 2, query_len: 9 });
    expect(JSON.stringify(payload)).not.toMatch(/road|trip/i);
    // An emoji is one character, and decomposed accents fold away as Cloud's normalizer folds them.
    expect(mentionPickFeedbackPayload({ ...pagePick, query: '👍é' })?.query_len).toBe(2);
  });

  it.each([0, -1, 1.5, Number.NaN, MENTION_PICK_MAX_POSITION + 1])('leaves out the position %p', (position) => {
    expect(mentionPickFeedbackPayload({ ...pagePick, position })).not.toHaveProperty('position');
  });

  it('keeps the bounds themselves', () => {
    expect(mentionPickFeedbackPayload({ ...pagePick, position: 1 })?.position).toBe(1);
    expect(mentionPickFeedbackPayload({ ...pagePick, position: MENTION_PICK_MAX_POSITION })?.position).toBe(
      MENTION_PICK_MAX_POSITION
    );
  });
});
