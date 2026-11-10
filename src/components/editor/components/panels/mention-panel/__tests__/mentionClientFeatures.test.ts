import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import {
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';
import { getConfigValue } from '@/utils/runtime-config';
import { SERVER_INFO_LOADING, ServerInfoState, updateServerInfo } from '@/utils/server-info';

import {
  MENTION_FEATURE_SECTION_DEGRADATION_V1,
  MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
  mentionClientFeatures,
  WEB_MENTION_CLIENT_FEATURES,
} from '../mentionClientFeatures';
import {
  buildMentionSearchCacheKey,
  buildMentionSearchRequests,
  isCacheableMentionResponse,
  isCompleteMentionResponse,
} from '../mentionUtils';

function available(mentionFeatures: unknown): ServerInfoState {
  return {
    status: 'available',
    info: { enable_page_history: true, mention_features: mentionFeatures } as ServerInfo,
  };
}

const REQUEST: MentionSearchRequest = {
  query: 'road',
  limit: 20,
  include: [MentionTargetKind.Person, MentionTargetKind.Page],
};
const FEATURES = [MENTION_FEATURE_SECTION_DEGRADATION_V1, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1];

function response(statuses: string[], partial?: boolean): MentionSearchResponse {
  return {
    sections: statuses.map((status, index) => ({
      kind: index === 0 ? MentionSearchSectionKind.Pages : MentionSearchSectionKind.People,
      title: 'section',
      items: [],
      has_more: false,
      status,
    })),
    ...(partial === undefined ? {} : { partial }),
  };
}

describe('mentionClientFeatures (MEN-WEB-09)', () => {
  afterEach(() => {
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), SERVER_INFO_LOADING);
  });

  it('handles the two opt-ins Cloud defines, in sorted order', () => {
    expect(WEB_MENTION_CLIENT_FEATURES).toEqual(['section_degradation_v1', 'typeahead_deadline_v1']);
    expect([...WEB_MENTION_CLIENT_FEATURES].sort()).toEqual(WEB_MENTION_CLIENT_FEATURES);
    expect(Object.isFrozen(WEB_MENTION_CLIENT_FEATURES)).toBe(true);
  });

  it('sends what the server advertises and the client handles, nothing else', () => {
    expect(
      mentionClientFeatures(
        available(['session_metrics_v1', 'typeahead_deadline_v1', 'unknown_v9', 'section_degradation_v1'])
      )
    ).toEqual(FEATURES);
    expect(mentionClientFeatures(available(['typeahead_deadline_v1']))).toEqual(['typeahead_deadline_v1']);
    expect(mentionClientFeatures(available(['session_metrics_v1', 'short_prefix_v1']))).toEqual([]);
  });

  it('sends nothing while server info is loading, failed, from an older server, or malformed', () => {
    const none = mentionClientFeatures(SERVER_INFO_LOADING);

    expect(none).toEqual([]);
    expect(mentionClientFeatures({ status: 'unavailable' })).toBe(none);
    expect(mentionClientFeatures({ status: 'unsupported' })).toBe(none);
    expect(mentionClientFeatures(available(undefined))).toBe(none);
    expect(mentionClientFeatures(available('section_degradation_v1'))).toBe(none);
    expect(mentionClientFeatures(available([]))).toBe(none);
  });

  it('reads the server-info snapshot by default', () => {
    expect(mentionClientFeatures()).toEqual([]);
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), available(FEATURES));
    expect(mentionClientFeatures()).toEqual(FEATURES);
  });

  describe('the cache key', () => {
    it('stays as it was for a request without opt-ins', () => {
      const key = buildMentionSearchCacheKey(REQUEST);

      expect(key).not.toContain('client_features');
      expect(buildMentionSearchCacheKey({ ...REQUEST, client_features: [] })).toBe(key);
      expect(JSON.parse(key)).toEqual({
        query: 'road',
        limit: 20,
        cursor: null,
        include: ['page', 'person'],
        context: { view_id: null, database_id: null, database_view_id: null, row_id: null },
        filter: { database_ids: [], database_view_ids: [], database_row_ids: [] },
      });
    });

    it('holds the opt-ins, sorted and once each, so their answers never answer a request without them', () => {
      const key = buildMentionSearchCacheKey({ ...REQUEST, client_features: [...FEATURES].reverse() });

      expect(key).not.toBe(buildMentionSearchCacheKey(REQUEST));
      expect(JSON.parse(key).client_features).toEqual(FEATURES);
      expect(buildMentionSearchCacheKey({ ...REQUEST, client_features: [...FEATURES, FEATURES[0]] })).toBe(key);
      expect(buildMentionSearchCacheKey({ ...REQUEST, client_features: [FEATURES[0]] })).not.toBe(key);
    });

    it('is carried by every lane of a search', () => {
      const requests = buildMentionSearchRequests({ ...REQUEST, include: undefined, client_features: FEATURES });

      expect(requests.map((request) => request.client_features)).toEqual([FEATURES, FEATURES]);
      expect(
        buildMentionSearchRequests({ ...REQUEST, query: '', client_features: FEATURES })[0].client_features
      ).toEqual(FEATURES);
    });
  });

  describe('caching an answer to a request that opted in', () => {
    const optedIn = { ...REQUEST, client_features: FEATURES };

    it('keeps no partial answer and no answer with a partial section', () => {
      expect(isCacheableMentionResponse(optedIn, response(['ok', 'ok']))).toBe(true);
      expect(isCacheableMentionResponse(optedIn, response(['ok', 'ok'], false))).toBe(true);
      expect(isCacheableMentionResponse(optedIn, response(['ok', 'ok'], true))).toBe(false);
      expect(isCacheableMentionResponse(optedIn, response(['partial', 'ok']))).toBe(false);
      expect(isCacheableMentionResponse(optedIn, response(['ok', 'failed']))).toBe(false);
    });

    it('caches as before without opt-ins: partial alone is kept', () => {
      expect(isCacheableMentionResponse(REQUEST, response(['ok', 'ok'], true))).toBe(true);
      expect(isCacheableMentionResponse(REQUEST, response(['partial', 'ok']))).toBe(true);
      expect(isCacheableMentionResponse(REQUEST, response(['ok', 'failed']))).toBe(false);
    });

    it('still shows a partial answer as complete', () => {
      expect(isCompleteMentionResponse(optedIn, response(['partial', 'ok'], true))).toBe(true);
      expect(isCompleteMentionResponse(optedIn, response(['ok', 'failed'], true))).toBe(false);
    });
  });
});
