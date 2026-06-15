import { expect, describe, it } from '@jest/globals';

/**
 * Test helpers - replicating the logic from AIMeetingSpeakerBlock.tsx
 */

const parseSpeakerInfoMap = (raw: unknown) => {
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;

      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, Record<string, unknown>>;
  }

  return null;
};

const getBaseSpeakerId = (speakerId: string) => {
  const [base] = speakerId.split('_');

  return base || speakerId;
};

interface SpeakerInfo {
  name: string;
  email: string;
  avatarUrl: string;
}

const resolveSpeakerInfo = (
  speakerId?: string,
  infoMap?: Record<string, Record<string, unknown>> | null,
  unknownLabel?: string,
  fallbackLabel?: (id: string) => string
): SpeakerInfo => {
  const resolvedUnknownLabel = unknownLabel ?? 'Unknown speaker';

  if (!speakerId) {
    return {
      name: resolvedUnknownLabel,
      email: '',
      avatarUrl: '',
    };
  }

  const baseId = getBaseSpeakerId(speakerId);
  const info = infoMap?.[speakerId] ?? infoMap?.[baseId];
  const name = typeof info?.name === 'string' ? info?.name?.trim() : '';
  const email = typeof info?.email === 'string' ? info?.email?.trim() : '';
  const avatarUrl = typeof info?.avatar_url === 'string' ? info?.avatar_url?.trim() : '';

  if (name) {
    return {
      name,
      email,
      avatarUrl,
    };
  }

  if (!baseId) {
    return {
      name: resolvedUnknownLabel,
      email,
      avatarUrl,
    };
  }

  return {
    name: fallbackLabel ? fallbackLabel(baseId) : `Speaker ${baseId}`,
    email,
    avatarUrl,
  };
};

const getAvatarLabel = (
  speakerName: string,
  speakerId: string | undefined,
  unknownLabel: string
): string => {
  if (speakerName && speakerName !== unknownLabel) {
    return speakerName.trim().charAt(0).toUpperCase();
  }

  if (speakerId) return getBaseSpeakerId(speakerId).charAt(0).toUpperCase();
  return '?';
};

describe('AIMeetingSpeakerBlock Logic', () => {
  const unknownLabel = 'Unknown speaker';
  const getFallbackLabel = (id: string) => `Speaker ${id}`;

  describe('resolveSpeakerInfo', () => {
    it('should return unknown label for undefined speaker id', () => {
      const result = resolveSpeakerInfo(undefined, null, unknownLabel, getFallbackLabel);

      expect(result.name).toBe(unknownLabel);
      expect(result.email).toBe('');
      expect(result.avatarUrl).toBe('');
    });

    it('should return full speaker info when available', () => {
      const infoMap = {
        speaker1: {
          name: 'Alice Johnson',
          email: 'alice@example.com',
          avatar_url: 'https://example.com/alice.jpg',
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Alice Johnson');
      expect(result.email).toBe('alice@example.com');
      expect(result.avatarUrl).toBe('https://example.com/alice.jpg');
    });

    it('should lookup by base id when direct match not found', () => {
      const infoMap = {
        speaker1: {
          name: 'Alice',
          email: 'alice@example.com',
        },
      };

      const result = resolveSpeakerInfo('speaker1_segment5', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
    });

    it('should prefer direct match over base id match', () => {
      const infoMap = {
        speaker1: {
          name: 'Alice (Base)',
        },
        speaker1_segment5: {
          name: 'Alice (Segment 5)',
        },
      };

      const result = resolveSpeakerInfo('speaker1_segment5', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Alice (Segment 5)');
    });

    it('should use fallback label when name is not available', () => {
      const infoMap = {
        speaker1: {
          email: 'alice@example.com',
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Speaker speaker1');
      expect(result.email).toBe('alice@example.com');
    });

    it('should handle empty name as fallback', () => {
      const infoMap = {
        speaker1: {
          name: '',
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Speaker speaker1');
    });

    it('should handle whitespace-only name as fallback', () => {
      const infoMap = {
        speaker1: {
          name: '   ',
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Speaker speaker1');
    });

    it('should trim whitespace from all fields', () => {
      const infoMap = {
        speaker1: {
          name: '  Alice  ',
          email: '  alice@example.com  ',
          avatar_url: '  https://example.com/alice.jpg  ',
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
      expect(result.avatarUrl).toBe('https://example.com/alice.jpg');
    });

    it('should handle missing info map', () => {
      const result = resolveSpeakerInfo('speaker1', null, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Speaker speaker1');
    });

    it('should handle non-string field values', () => {
      const infoMap = {
        speaker1: {
          name: 123,
          email: true,
          avatar_url: { url: 'test' },
        },
      };

      const result = resolveSpeakerInfo('speaker1', infoMap as unknown as Record<string, Record<string, unknown>>, unknownLabel, getFallbackLabel);

      expect(result.name).toBe('Speaker speaker1');
      expect(result.email).toBe('');
      expect(result.avatarUrl).toBe('');
    });
  });

  describe('getAvatarLabel', () => {
    it('should return first character of speaker name uppercased', () => {
      expect(getAvatarLabel('Alice', 'speaker1', unknownLabel)).toBe('A');
      expect(getAvatarLabel('bob', 'speaker2', unknownLabel)).toBe('B');
      expect(getAvatarLabel('Charlie Smith', 'speaker3', unknownLabel)).toBe('C');
    });

    it('should use speaker id when name is unknown label', () => {
      expect(getAvatarLabel(unknownLabel, 'speaker1', unknownLabel)).toBe('S');
      expect(getAvatarLabel(unknownLabel, 'alice_1', unknownLabel)).toBe('A');
    });

    it('should use speaker id when name is empty', () => {
      expect(getAvatarLabel('', 'speaker1', unknownLabel)).toBe('S');
    });

    it('should return ? when no speaker id', () => {
      expect(getAvatarLabel(unknownLabel, undefined, unknownLabel)).toBe('?');
      expect(getAvatarLabel('', undefined, unknownLabel)).toBe('?');
    });

    it('should handle whitespace in name', () => {
      expect(getAvatarLabel('  Alice  ', 'speaker1', unknownLabel)).toBe('A');
    });
  });

  describe('parseSpeakerInfoMap', () => {
    it('should parse valid JSON string with multiple speakers', () => {
      const jsonStr = JSON.stringify({
        speaker1: { name: 'Alice', email: 'alice@example.com' },
        speaker2: { name: 'Bob', avatar_url: 'https://example.com/bob.jpg' },
        speaker3: { name: 'Charlie' },
      });

      const result = parseSpeakerInfoMap(jsonStr);

      expect(result).not.toBeNull();
      expect(Object.keys(result!)).toHaveLength(3);
      expect(result?.speaker1.name).toBe('Alice');
      expect(result?.speaker2.avatar_url).toBe('https://example.com/bob.jpg');
    });

    it('should return object directly if already parsed', () => {
      const obj = {
        speaker1: { name: 'Alice' },
      };

      const result = parseSpeakerInfoMap(obj);

      expect(result).toBe(obj);
    });

    it('should handle empty object', () => {
      const result = parseSpeakerInfoMap({});

      expect(result).toEqual({});
    });

    it('should handle empty JSON string', () => {
      const result = parseSpeakerInfoMap('{}');

      expect(result).toEqual({});
    });
  });

  describe('getBaseSpeakerId', () => {
    it('should extract base id with various suffixes', () => {
      expect(getBaseSpeakerId('speaker1_0')).toBe('speaker1');
      expect(getBaseSpeakerId('speaker1_segment_1')).toBe('speaker1');
      expect(getBaseSpeakerId('user_abc_def')).toBe('user');
    });

    it('should return full id if no underscore', () => {
      expect(getBaseSpeakerId('speaker1')).toBe('speaker1');
      expect(getBaseSpeakerId('alice')).toBe('alice');
    });

    it('should handle numeric ids', () => {
      expect(getBaseSpeakerId('123_456')).toBe('123');
      expect(getBaseSpeakerId('123')).toBe('123');
    });
  });
});

describe('Speaker Display Integration', () => {
  const unknownLabel = 'Unknown speaker';
  const getFallbackLabel = (id: string) => `Speaker ${id}`;

  it('should correctly display speaker with full info', () => {
    const infoMap = {
      alice: {
        name: 'Alice Johnson',
        email: 'alice@company.com',
        avatar_url: 'https://example.com/alice.png',
      },
    };

    const info = resolveSpeakerInfo('alice', infoMap, unknownLabel, getFallbackLabel);
    const avatarLabel = getAvatarLabel(info.name, 'alice', unknownLabel);

    expect(info.name).toBe('Alice Johnson');
    expect(avatarLabel).toBe('A');
    expect(info.avatarUrl).toBeTruthy();
  });

  it('should correctly display speaker with only name', () => {
    const infoMap = {
      bob: { name: 'Bob' },
    };

    const info = resolveSpeakerInfo('bob', infoMap, unknownLabel, getFallbackLabel);
    const avatarLabel = getAvatarLabel(info.name, 'bob', unknownLabel);

    expect(info.name).toBe('Bob');
    expect(avatarLabel).toBe('B');
    expect(info.avatarUrl).toBe('');
  });

  it('should correctly display unknown speaker', () => {
    const info = resolveSpeakerInfo('unknown_speaker_5', null, unknownLabel, getFallbackLabel);
    const avatarLabel = getAvatarLabel(info.name, 'unknown_speaker_5', unknownLabel);

    expect(info.name).toBe('Speaker unknown');
    expect(avatarLabel).toBe('S');
  });

  it('should handle segment-based speaker ids', () => {
    const infoMap = {
      speaker1: { name: 'First Speaker' },
    };

    // Multiple segments from same speaker
    const info1 = resolveSpeakerInfo('speaker1_0', infoMap, unknownLabel, getFallbackLabel);
    const info2 = resolveSpeakerInfo('speaker1_1', infoMap, unknownLabel, getFallbackLabel);
    const info3 = resolveSpeakerInfo('speaker1_2', infoMap, unknownLabel, getFallbackLabel);

    expect(info1.name).toBe('First Speaker');
    expect(info2.name).toBe('First Speaker');
    expect(info3.name).toBe('First Speaker');
  });
});
