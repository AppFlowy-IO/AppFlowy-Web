import { Element } from 'slate';

import { BlockType } from '@/application/types';

import {
  buildSpeakerInferencePrompt,
  getDefaultSpeakers,
  inferMeetingSpeakers,
  isDefaultSpeakerName,
  mergeSpeakerInference,
  parseSpeakerInferenceResponse,
  readSpeakerInfoMap,
  resolveMeetingSpeakerName,
} from '../ai-meeting.speaker-inference';

const speakerLabel = (id: string) => `Speaker ${id}`;
const transcript = (...ids: string[]): Element => ({
  type: BlockType.AIMeetingTranscriptionBlock,
  children: ids.map((id) => ({ type: BlockType.AIMeetingSpeakerBlock, data: { speaker_id: id }, children: [{ text: 'Hello' }] })),
});

describe('Flutter SpeakerUtil default speaker cases', () => {
  it.each(['', 'Speaker A', 'Speaker B', 'Speaker C', 'Speaker Z', 'speaker a', 'speaker b', 'SPEAKER A'])('recognizes %j as a default name', (name) => {
    expect(isDefaultSpeakerName(name, speakerLabel)).toBe(true);
  });

  it.each(['John', 'John Smith', 'Sarah', 'Dr. Smith', 'Speaker 1', 'The Speaker', 'Speaker AB', 'Main Speaker'])('preserves the custom name %j', (name) => {
    expect(isDefaultSpeakerName(name, speakerLabel)).toBe(false);
  });

  it('recognizes localized placeholders', () => {
    expect(isDefaultSpeakerName('Sprecher A', (id) => `Sprecher ${id}`)).toBe(true);
    expect(isDefaultSpeakerName('Sprecher Alex', (id) => `Sprecher ${id}`)).toBe(false);
  });

  it('handles empty inputs and transcripts without speaker nodes', () => {
    expect(getDefaultSpeakers(undefined, {}, speakerLabel)).toEqual({});
    expect(getDefaultSpeakers({ type: BlockType.AIMeetingTranscriptionBlock, children: [{ type: BlockType.Paragraph, children: [{ text: 'Plain transcript' }] }] }, {}, speakerLabel)).toEqual({});
  });

  it('includes placeholders and empty names, excludes custom names, and deduplicates unique IDs', () => {
    expect(getDefaultSpeakers(undefined, {
      A: { name: 'Speaker A' }, A_123: { name: 'Speaker A' },
      B: { name: 'John Smith' }, C: { name: '' }, D: { name: 'Sarah' },
    }, speakerLabel)).toEqual({ A: 'Speaker A', C: 'Speaker C' });
  });

  it('extracts base IDs from repeated/unique transcript speaker nodes', () => {
    expect(getDefaultSpeakers(transcript('A', 'A_123', 'B_456', 'B'), {}, speakerLabel)).toEqual({ A: 'Speaker A', B: 'Speaker B' });
  });

  it('combines map defaults with speakers missing from the map', () => {
    expect(getDefaultSpeakers(transcript('A', 'C'), { A: { name: 'Speaker A' }, B: { name: 'Speaker B' } }, speakerLabel)).toEqual({ A: 'Speaker A', B: 'Speaker B', C: 'Speaker C' });
  });

  it('does not infer existing custom names, including unique IDs', () => {
    expect(getDefaultSpeakers(transcript('A_123', 'B', 'C', 'D'), { A_123: { name: 'John' }, B: { name: 'Sarah' } }, speakerLabel)).toEqual({ C: 'Speaker C', D: 'Speaker D' });
  });

  it('reads both native JSON and web object maps without retaining malformed entries', () => {
    expect(readSpeakerInfoMap('{"A":{"name":"Annie"},"B":null,"C":[]}')).toEqual({ A: { name: 'Annie' } });
    expect(readSpeakerInfoMap({ A: { name: 'Annie' } })).toEqual({ A: { name: 'Annie' } });
    expect(readSpeakerInfoMap('invalid')).toEqual({});
  });
});

describe('Flutter inference prompt and response', () => {
  it('requests conservative names and title, accepts external guests, and passes only member names', () => {
    const prompt = buildSpeakerInferencePrompt({
      transcript: 'Speaker A: Hi, I am Annie.', defaultSpeakers: { A: 'Speaker A', B: 'Speaker B' },
      languageCode: 'DE', notes: 'Annie is presenting.', workspaceMembers: [{ name: '  Annie  ' }, { name: '' }],
    });

    expect(prompt).toContain('code: DE');
    expect(prompt).toContain('Keep it under 60 characters');
    expect(prompt).toContain('use null');
    expect(prompt).toContain('External guests, clients, or partners may also be present');
    expect(prompt).toContain('- Annie\n');
    expect(prompt).toContain('## Meeting Notes (Reference Only)');
    expect(prompt).toContain('Speaker A: Hi, I am Annie.');
    const withoutContext = buildSpeakerInferencePrompt({ transcript: 'Hi', defaultSpeakers: {}, languageCode: 'EN' });

    expect(withoutContext).not.toContain('## Known Workspace Members');
    expect(withoutContext).not.toContain('## Meeting Notes');
  });

  it.each(['', '```json\n', '```\n'])('accepts native JSON with fence %j', (fence) => {
    const response = `${fence}{"speakers":{"A":"Annie","B":null,"C":"Unknown","D":"null","E":"  ","F":42,"invented":"Name"},"title":"Planning"}${fence ? '\n```' : ''}`;

    expect(parseSpeakerInferenceResponse(response, { A: 'Speaker A', B: 'Speaker B', C: 'Speaker C', D: 'Speaker D', E: 'Speaker E', F: 'Speaker F' }))
      .toEqual({ speakers: { A: 'Annie' }, title: 'Planning' });
  });

  it.each(['not JSON', 'null', '[]', '42'])('ignores malformed response %j', (response) => {
    expect(parseSpeakerInferenceResponse(response, { A: 'Speaker A' })).toBeNull();
  });

  it.each([null, '', 'null', 'x'.repeat(101)])('ignores invalid title %j', (title) => {
    expect(parseSpeakerInferenceResponse(JSON.stringify({ speakers: { A: 'Annie' }, title }), { A: 'Speaker A' })).toEqual({ speakers: { A: 'Annie' } });
  });

  it('saves inferred names while retaining metadata, unique IDs, and a custom title', () => {
    const updates = mergeSpeakerInference({
      inference: { speakers: { A: 'Annie', B: 'Wrong name', invented: 'Someone' }, title: 'AI title' },
      defaultSpeakers: { A: 'Speaker A' },
      currentData: { title: 'YouTube title', speaker_info_map: { A_123: { name: 'Speaker A', avatar_url: 'avatar' }, B: { name: 'Custom' } } },
      speakerLabel, defaultTitle: 'Meeting',
    });

    expect(updates.title).toBeUndefined();
    const names = readSpeakerInfoMap(updates.speaker_info_map);

    expect(names).toEqual({ A: { name: 'Annie' }, A_123: { name: 'Annie', avatar_url: 'avatar' }, B: { name: 'Custom' } });
    expect(resolveMeetingSpeakerName('A_123', names, speakerLabel, 'Unknown')).toBe('Annie');
    expect(resolveMeetingSpeakerName('D', names, speakerLabel, 'Unknown')).toBe('Speaker D');
    expect(resolveMeetingSpeakerName(undefined, names, speakerLabel, 'Unknown')).toBe('Unknown');
  });

  it.each(['', 'Meeting'])('updates only the default title %j', (title) => {
    expect(mergeSpeakerInference({ inference: { speakers: {}, title: 'New title' }, defaultSpeakers: {}, currentData: { title }, speakerLabel, defaultTitle: 'Meeting' })).toEqual({ title: 'New title' });
  });

  it('preserves a speaker renamed during the AI request', () => {
    expect(mergeSpeakerInference({
      inference: { speakers: { A: 'AI guess' } }, defaultSpeakers: { A: 'Speaker A' },
      currentData: { speaker_info_map: { A_123: { name: 'Manually named' } } }, speakerLabel, defaultTitle: 'Meeting',
    })).toEqual({});
  });
});

describe('speaker completion streaming and recovery', () => {
  const setup = () => {
    const controller = new AbortController();
    const fetchAIAssistant = jest.fn();
    const loadWorkspaceMembers = jest.fn(async () => [{ name: 'Annie' }]);
    const run = (timeoutMs?: number) => inferMeetingSpeakers({
      request: { fetchAIAssistant }, transcript: 'Speaker A: Hi, I am Annie.', defaultSpeakers: { A: 'Speaker A' },
      languageCode: 'EN', notes: '', signal: controller.signal, timeoutMs, loadWorkspaceMembers,
    });

    return { controller, fetchAIAssistant, loadWorkspaceMembers, run };
  };

  afterEach(() => jest.useRealTimers());

  it('reads cumulative answer chunks and ignores assistant comments', async () => {
    const { fetchAIAssistant, run } = setup();

    fetchAIAssistant.mockImplementationOnce(async (_payload, callback) => {
      callback('{"speakers":', 'unrelated reasoning');
      callback('{"speakers":{"A":"Annie"},"title":null}', 'unrelated reasoning');
      return { streamPromise: Promise.resolve() };
    });
    expect(await run()).toEqual({ speakers: { A: 'Annie' } });
    expect(fetchAIAssistant.mock.calls[0][0]).toMatchObject({ assistantType: 8, ragIds: [], completionHistory: [] });
  });

  it('still infers names when optional workspace members cannot be loaded', async () => {
    const { fetchAIAssistant, loadWorkspaceMembers, run } = setup();

    loadWorkspaceMembers.mockRejectedValueOnce(new Error('Member service unavailable'));
    fetchAIAssistant.mockImplementationOnce(async (_payload, callback) => {
      callback('{"speakers":{"A":"Annie"}}', '');
      return { streamPromise: Promise.resolve() };
    });
    expect(await run()).toEqual({ speakers: { A: 'Annie' } });
    expect(fetchAIAssistant.mock.calls[0][0].customPrompt).not.toContain('## Known Workspace Members');
  });

  it('recovers from stream failures', async () => {
    const { fetchAIAssistant, run } = setup();

    fetchAIAssistant.mockImplementationOnce(async () => ({ streamPromise: Promise.reject(new Error('Connection lost')) }));
    expect(await run()).toBeNull();
  });

  it('aborts a stalled completion when it times out, allowing the summary to proceed', async () => {
    jest.useFakeTimers();
    const { fetchAIAssistant, run } = setup();

    fetchAIAssistant.mockImplementationOnce(async () => ({ streamPromise: new Promise(() => undefined) }));
    const running = run(1000);

    await jest.advanceTimersByTimeAsync(1000);
    expect(await running).toBeNull();
    expect(fetchAIAssistant.mock.calls[0][0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a pending member lookup without submitting a completion', async () => {
    const { controller, fetchAIAssistant, loadWorkspaceMembers, run } = setup();

    loadWorkspaceMembers.mockImplementationOnce(() => new Promise(() => undefined));
    const running = run();

    controller.abort();
    expect(await running).toBeNull();
    expect(fetchAIAssistant).not.toHaveBeenCalled();
  });

  it('does not submit a completion for an already aborted operation', async () => {
    const { controller, fetchAIAssistant, run } = setup();

    controller.abort();
    expect(await run()).toBeNull();
    expect(fetchAIAssistant).not.toHaveBeenCalled();
  });
});
