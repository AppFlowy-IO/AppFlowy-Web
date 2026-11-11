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
  MENTION_FEATURE_REASONS_V1,
  MENTION_FEATURE_SECTION_DEGRADATION_V1,
  MENTION_FEATURE_SELECTION_MEMORY_V1,
  MENTION_FEATURE_SUGGESTED_V1,
  MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
  MENTION_SELECTION_MEMORY_DEFAULT,
  MENTION_SELECTION_MEMORY_OVERRIDE_KEY,
  MENTION_SUGGESTED_DEFAULT,
  MENTION_SUGGESTED_OVERRIDE_KEY,
  mentionClientFeatures,
  MentionPickerClientFeatures,
  mentionPickerClientFeatures,
  NO_MENTION_PICKER_CLIENT_FEATURES,
  readMentionSelectionMemoryEnabled,
  readMentionSuggestedEnabled,
  WEB_MENTION_CLIENT_FEATURES,
  withMentionClientFeatures,
} from '../mentionClientFeatures';
import {
  buildMentionSearchCacheKey,
  buildMentionSearchRequests,
  buildMentionSearchRequestsCacheKey,
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

    it('caches as without opt-ins for the opt-ins that change nothing about how complete an answer is', () => {
      [MENTION_FEATURE_REASONS_V1, MENTION_FEATURE_SUGGESTED_V1, MENTION_FEATURE_SELECTION_MEMORY_V1].forEach(
        (feature) => {
          const request = { ...REQUEST, client_features: [feature] };

          expect(isCacheableMentionResponse(request, response(['ok', 'ok'], true))).toBe(true);
          expect(isCacheableMentionResponse(request, response(['partial', 'ok']))).toBe(true);
          expect(isCacheableMentionResponse(request, response(['ok', 'failed']))).toBe(false);
          // With a degradation opt-in beside it, the degradation rule holds.
          expect(
            isCacheableMentionResponse(
              { ...REQUEST, client_features: [feature, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1] },
              response(['ok', 'ok'], true)
            )
          ).toBe(false);
        }
      );
    });
  });
});

describe('the opt-ins of a picker opening (MEN-WEB-11)', () => {
  const EVERY_FEATURE = [
    MENTION_FEATURE_REASONS_V1,
    MENTION_FEATURE_SECTION_DEGRADATION_V1,
    MENTION_FEATURE_SELECTION_MEMORY_V1,
    MENTION_FEATURE_SUGGESTED_V1,
    MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
  ];
  const ALL_ON = { degradedAnswers: true, reasons: true, suggested: true, selectionMemory: true };
  const ALL_OFF = { degradedAnswers: false, reasons: false, suggested: false, selectionMemory: false };

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("uses Cloud's wire names", () => {
    expect([MENTION_FEATURE_REASONS_V1, MENTION_FEATURE_SUGGESTED_V1, MENTION_FEATURE_SELECTION_MEMORY_V1]).toEqual([
      'reasons_v1',
      'suggested_v1',
      'selection_memory_v1',
    ]);
  });

  it('sends each opt-in only while the server advertises it and the picker can use it, on its lanes', () => {
    expect(mentionPickerClientFeatures(ALL_ON, available(EVERY_FEATURE))).toEqual({
      every: [MENTION_FEATURE_SECTION_DEGRADATION_V1, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1, MENTION_FEATURE_REASONS_V1],
      bare: [MENTION_FEATURE_SUGGESTED_V1],
      typed: [MENTION_FEATURE_SELECTION_MEMORY_V1],
    });
    // Each switch keeps its own opt-ins out, and the others in.
    expect(mentionPickerClientFeatures(ALL_OFF, available(EVERY_FEATURE))).toBe(NO_MENTION_PICKER_CLIENT_FEATURES);
    expect(mentionPickerClientFeatures({ ...ALL_ON, selectionMemory: false }, available(EVERY_FEATURE))).toEqual({
      every: [MENTION_FEATURE_SECTION_DEGRADATION_V1, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1, MENTION_FEATURE_REASONS_V1],
      bare: [MENTION_FEATURE_SUGGESTED_V1],
      typed: [],
    });
    expect(mentionPickerClientFeatures({ ...ALL_OFF, selectionMemory: true }, available(EVERY_FEATURE))).toEqual({
      every: [],
      bare: [],
      typed: [MENTION_FEATURE_SELECTION_MEMORY_V1],
    });
    expect(mentionPickerClientFeatures({ ...ALL_ON, reasons: false }, available(EVERY_FEATURE)).every).toEqual([
      MENTION_FEATURE_SECTION_DEGRADATION_V1,
      MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
    ]);
    expect(mentionPickerClientFeatures({ ...ALL_ON, suggested: false }, available(EVERY_FEATURE)).bare).toEqual([]);
    expect(mentionPickerClientFeatures({ ...ALL_ON, degradedAnswers: false }, available(EVERY_FEATURE)).every).toEqual([
      MENTION_FEATURE_REASONS_V1,
    ]);
    // A server that advertises some of them gets those alone.
    expect(mentionPickerClientFeatures(ALL_ON, available([MENTION_FEATURE_SUGGESTED_V1, 'unknown_v9']))).toEqual({
      every: [],
      bare: [MENTION_FEATURE_SUGGESTED_V1],
      typed: [],
    });
  });

  it('sends none to a server that advertises none, nor while server info is loading or failed', () => {
    [
      SERVER_INFO_LOADING,
      { status: 'unavailable' } as ServerInfoState,
      { status: 'unsupported' } as ServerInfoState,
      available(undefined),
      available(['session_metrics_v1', 'section_degradation_v1x']),
    ].forEach((serverInfo) => {
      expect(mentionPickerClientFeatures(ALL_ON, serverInfo)).toBe(NO_MENTION_PICKER_CLIENT_FEATURES);
    });
  });

  describe('withMentionClientFeatures', () => {
    const features: MentionPickerClientFeatures = {
      every: [MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1, MENTION_FEATURE_REASONS_V1],
      bare: [MENTION_FEATURE_SUGGESTED_V1],
      typed: [MENTION_FEATURE_SELECTION_MEMORY_V1],
    };

    it("gives the bare `@` its own opt-ins and a typed query's requests theirs, sorted", () => {
      const bare = withMentionClientFeatures({ ...REQUEST, query: ' ' }, features);
      const typed = withMentionClientFeatures(REQUEST, features);

      expect(bare.client_features).toEqual(['reasons_v1', 'suggested_v1', 'typeahead_deadline_v1']);
      expect(typed.client_features).toEqual(['reasons_v1', 'selection_memory_v1', 'typeahead_deadline_v1']);
      // Both of a typed query's requests carry them; the bare `@` is one request.
      expect(buildMentionSearchRequests({ ...typed, include: undefined }).map((r) => r.client_features)).toEqual([
        typed.client_features,
        typed.client_features,
      ]);
      expect(buildMentionSearchRequests(bare).map((r) => r.client_features)).toEqual([bare.client_features]);
    });

    it('leaves the field out when its lane carries none, and replaces what the request held', () => {
      const typedOnly = { ...NO_MENTION_PICKER_CLIENT_FEATURES, typed: [MENTION_FEATURE_SELECTION_MEMORY_V1] };
      const bare = withMentionClientFeatures({ ...REQUEST, query: '', client_features: ['stale_v0'] }, typedOnly);

      expect(bare).not.toHaveProperty('client_features');
      expect(bare).toEqual({ ...REQUEST, query: '' });
      expect(withMentionClientFeatures(REQUEST, NO_MENTION_PICKER_CLIENT_FEATURES)).toEqual(REQUEST);
    });

    it('keys answers to different opt-ins apart, and a lane by its own opt-ins only', () => {
      const bareKey = (lane: MentionPickerClientFeatures) =>
        buildMentionSearchRequestsCacheKey(
          buildMentionSearchRequests(withMentionClientFeatures({ ...REQUEST, query: '' }, lane))
        );
      const typedKey = (lane: MentionPickerClientFeatures) =>
        buildMentionSearchRequestsCacheKey(buildMentionSearchRequests(withMentionClientFeatures(REQUEST, lane)));
      const none = NO_MENTION_PICKER_CLIENT_FEATURES;
      const suggested = { ...none, bare: [MENTION_FEATURE_SUGGESTED_V1] };
      const memory = { ...none, typed: [MENTION_FEATURE_SELECTION_MEMORY_V1] };
      const reasons = { ...none, every: [MENTION_FEATURE_REASONS_V1] };

      expect(bareKey(suggested)).not.toBe(bareKey(none));
      expect(bareKey(reasons)).not.toBe(bareKey(none));
      expect(bareKey(reasons)).not.toBe(bareKey(suggested));
      expect(typedKey(memory)).not.toBe(typedKey(none));
      expect(typedKey(reasons)).not.toBe(typedKey(none));
      // An opt-in another lane carries leaves a lane's key as it was.
      expect(bareKey(memory)).toBe(bareKey(none));
      expect(typedKey(suggested)).toBe(typedKey(none));
    });
  });

  describe('the Suggested switch', () => {
    it('is off by default, and a browser turns it on or off', () => {
      expect(MENTION_SUGGESTED_DEFAULT).toBe(false);
      expect(readMentionSuggestedEnabled()).toBe(false);
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
      expect(readMentionSuggestedEnabled()).toBe(true);
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'false');
      expect(readMentionSuggestedEnabled()).toBe(false);
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'yes');
      expect(readMentionSuggestedEnabled()).toBe(false);
    });

    it('gives the default when storage cannot be read', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(readMentionSuggestedEnabled()).toBe(MENTION_SUGGESTED_DEFAULT);
    });
  });

  describe('the selection memory switch', () => {
    it("is on by default, so the server's advertisement decides, and a browser turns it off or on", () => {
      expect(MENTION_SELECTION_MEMORY_DEFAULT).toBe(true);
      expect(MENTION_SELECTION_MEMORY_OVERRIDE_KEY).toBe('__mention_selection_memory');
      expect(readMentionSelectionMemoryEnabled()).toBe(true);
      localStorage.setItem(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, 'false');
      expect(readMentionSelectionMemoryEnabled()).toBe(false);
      localStorage.setItem(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, 'true');
      expect(readMentionSelectionMemoryEnabled()).toBe(true);
      localStorage.setItem(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, 'no');
      expect(readMentionSelectionMemoryEnabled()).toBe(true);
    });

    it('gives the default when storage cannot be read', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(readMentionSelectionMemoryEnabled()).toBe(MENTION_SELECTION_MEMORY_DEFAULT);
    });
  });
});
