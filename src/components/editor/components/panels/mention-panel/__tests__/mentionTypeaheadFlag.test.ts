import {
  MENTION_DEFAULT_HIGHLIGHT_DEFAULT,
  MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY,
  MENTION_LOCAL_LANE_DEFAULT,
  MENTION_LOCAL_LANE_OVERRIDE_KEY,
  MENTION_LOCAL_ROWS_DEFAULT,
  MENTION_LOCAL_ROWS_OVERRIDE_KEY,
  MENTION_LOCAL_ROWS_SKIP_SERVER_DEFAULT,
  MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY,
  MENTION_TYPEAHEAD_LEGACY,
  MENTION_TYPEAHEAD_V2_DEFAULT,
  MENTION_TYPEAHEAD_V2_OVERRIDE_KEY,
  readMentionTypeaheadSettings,
} from '../mentionTypeaheadFlag';

describe('mentionTypeaheadFlag', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the picker as it was by default', () => {
    expect(MENTION_TYPEAHEAD_V2_DEFAULT).toBe(false);
    expect(MENTION_DEFAULT_HIGHLIGHT_DEFAULT).toBe(false);
    expect(readMentionTypeaheadSettings()).toEqual(MENTION_TYPEAHEAD_LEGACY);
    expect(MENTION_TYPEAHEAD_LEGACY).toEqual({
      v2: false,
      defaultHighlight: false,
      localLane: false,
      localRows: false,
      skipServerRows: false,
    });
  });

  it('turns v2 on from the browser override, and the default highlight only with it', () => {
    localStorage.setItem(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings()).toEqual(MENTION_TYPEAHEAD_LEGACY);

    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings()).toEqual({
      v2: true,
      defaultHighlight: true,
      localLane: true,
      localRows: true,
      skipServerRows: false,
    });

    localStorage.removeItem(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY);
    expect(readMentionTypeaheadSettings()).toMatchObject({ v2: true, defaultHighlight: false, localLane: true });
  });

  // MEN-WEB-09: the local lane comes with v2, and only with it, unless the browser turns it off.
  it('turns the local lane on with v2, and off only from its own override', () => {
    expect(MENTION_LOCAL_LANE_DEFAULT).toBe(true);

    localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings().localLane).toBe(false);

    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings().localLane).toBe(true);

    localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');
    expect(readMentionTypeaheadSettings()).toEqual({
      v2: true,
      defaultHighlight: false,
      localLane: false,
      localRows: false,
      skipServerRows: false,
    });

    localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'FALSE');
    expect(readMentionTypeaheadSettings().localLane).toBe(MENTION_LOCAL_LANE_DEFAULT);
  });

  // MEN-WEB-15: the local rows lane comes with the local lane; leaving the server's rows request out
  // is a switch of its own, off by default, and only with the rows lane.
  it('turns the local rows lane on with the local lane, and skipping the server rows only from its override', () => {
    expect(MENTION_LOCAL_ROWS_DEFAULT).toBe(true);
    expect(MENTION_LOCAL_ROWS_SKIP_SERVER_DEFAULT).toBe(false);

    localStorage.setItem(MENTION_LOCAL_ROWS_OVERRIDE_KEY, 'true');
    localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings()).toEqual(MENTION_TYPEAHEAD_LEGACY);

    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    localStorage.removeItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY);
    expect(readMentionTypeaheadSettings()).toMatchObject({ localRows: true, skipServerRows: false });

    localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');
    expect(readMentionTypeaheadSettings()).toMatchObject({ localRows: true, skipServerRows: true });

    localStorage.setItem(MENTION_LOCAL_ROWS_OVERRIDE_KEY, 'false');
    expect(readMentionTypeaheadSettings()).toMatchObject({ localLane: true, localRows: false, skipServerRows: false });

    localStorage.removeItem(MENTION_LOCAL_ROWS_OVERRIDE_KEY);
    localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');
    expect(readMentionTypeaheadSettings()).toMatchObject({ localLane: false, localRows: false, skipServerRows: false });
  });

  it.each(['false', 'TRUE', '1', ''])('reads %p as the default', (value) => {
    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, value);
    expect(readMentionTypeaheadSettings().v2).toBe(MENTION_TYPEAHEAD_V2_DEFAULT);
  });

  it('gives the defaults when storage throws on read or on access', () => {
    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readMentionTypeaheadSettings()).toEqual(MENTION_TYPEAHEAD_LEGACY);

    jest.restoreAllMocks();
    jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readMentionTypeaheadSettings()).toEqual(MENTION_TYPEAHEAD_LEGACY);
  });
});
