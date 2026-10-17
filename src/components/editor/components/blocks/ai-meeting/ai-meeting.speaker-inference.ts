import { Element, Node } from 'slate';

import { AIMeetingBlockData, BlockType } from '@/application/types';
import type { WriterRequest } from '@/components/chat/request/writer-request';
import { AIAssistantType } from '@/components/chat/types/writer';

import { buildCopyText, buildTranscriptCopyText, getBaseSpeakerId, parseSpeakerInfoMap } from './ai-meeting.utils';

type SpeakerInfoMap = Record<string, Record<string, unknown>>;
type SpeakerLabel = (id: string) => string;

export interface SpeakerInferenceResult {
  speakers: Record<string, string>;
  title?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function readSpeakerInfoMap(raw: unknown): SpeakerInfoMap {
  const parsed = parseSpeakerInfoMap(raw);

  return Object.fromEntries(Object.entries(isRecord(parsed) ? parsed : {}).filter(([, info]) => isRecord(info)));
}

export function isDefaultSpeakerName(name: unknown, speakerLabel: SpeakerLabel): boolean {
  const value = typeof name === 'string' ? name.trim() : '';

  if (!value || /^Speaker\s+[A-Z]$/i.test(value)) return true;
  const letter = value.match(/\s+([A-Z])$/i)?.[1]?.toUpperCase();

  return Boolean(letter && value === speakerLabel(letter));
}

/** Flutter's SpeakerUtil combines placeholder map entries with unmapped transcript speakers. */
export function getDefaultSpeakers(
  transcriptNode: Node | undefined,
  speakerInfoMap: SpeakerInfoMap,
  speakerLabel: SpeakerLabel
): Record<string, string> {
  const defaults: Record<string, string> = {};
  const mappedIds = new Set<string>();

  Object.entries(speakerInfoMap).forEach(([id, info]) => {
    const baseId = getBaseSpeakerId(id);

    mappedIds.add(baseId);
    if (isDefaultSpeakerName(info.name, speakerLabel) && !Object.hasOwn(defaults, baseId)) {
      defaults[baseId] = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : speakerLabel(baseId);
    }
  });

  if (transcriptNode && Element.isElement(transcriptNode)) {
    transcriptNode.children.forEach((child) => {
      if (!Element.isElement(child) || child.type !== BlockType.AIMeetingSpeakerBlock) return;
      const data = child.data as Record<string, unknown> | undefined;
      const id = data?.speaker_id ?? data?.speakerId;

      if (typeof id !== 'string' || !id) return;
      const baseId = getBaseSpeakerId(id);

      if (!mappedIds.has(baseId)) defaults[baseId] = speakerLabel(baseId);
    });
  }

  return defaults;
}

export function resolveMeetingSpeakerName(
  id: string | undefined,
  speakerInfoMap: SpeakerInfoMap,
  speakerLabel: SpeakerLabel,
  unknownLabel: string
) {
  if (!id) return unknownLabel;
  const info = speakerInfoMap[id] ?? speakerInfoMap[getBaseSpeakerId(id)];
  const name = typeof info?.name === 'string' ? info.name.trim() : '';

  return name || speakerLabel(getBaseSpeakerId(id));
}

export function buildSpeakerInferenceTranscript(transcriptNode: Node | undefined, resolveName: (id?: string) => string) {
  if (!transcriptNode) return '';
  return buildTranscriptCopyText(transcriptNode, resolveName) || buildCopyText(transcriptNode);
}

/** Port of AIMeetingTemplateManager.buildAutoGuessPrompt; this is a separate completion from the summary. */
export function buildSpeakerInferencePrompt({
  transcript,
  defaultSpeakers,
  languageCode,
  workspaceMembers = [],
  notes,
}: {
  transcript: string;
  defaultSpeakers: Record<string, string>;
  languageCode: string;
  workspaceMembers?: readonly { name: string }[];
  notes?: string;
}) {
  const speakerList = Object.entries(defaultSpeakers).map(([id, name]) => `- ${id}: Currently labeled as "${name}"`).join('\n');
  const examples = Object.keys(defaultSpeakers).map((id) => `${JSON.stringify(id)}: "Detected Name or null if unknown"`).join(', ');
  const members = workspaceMembers.map((member) => member.name.trim()).filter(Boolean);
  const memberSection = members.length ? `
## Known Workspace Members (Reference Only)
The following people are members of this workspace and may be participating in this meeting:
${members.map((name) => `- ${name}`).join('\n')}

Note: Meeting participants are NOT limited to this list. External guests, clients, or partners may also be present.
When identifying speakers, prefer matching to these known members if the transcript clearly indicates they are participating.
However, if a speaker is not in this list, identify them from the transcript context.
` : '';
  const notesSection = notes?.trim() ? `
## Meeting Notes (Reference Only)
The following meeting notes provide additional context about the meeting content and may help identify speakers:

${notes}

Note: Use this context to better understand speaker roles and relationships, but always verify speaker identities from the transcript.
` : '';

  return `You are analyzing a meeting transcript to identify speaker names and generate a meeting title.

## Instructions

1. **Speaker Names**: Analyze the transcript to identify real names for each speaker. Look for:
   - Self-introductions ("Hi, I'm John...", "This is Sarah speaking...")
   - Others addressing speakers by name ("Thank you, Sarah...", "John, what do you think?")
   - Context clues about roles and names
   ${members.length ? '- When possible, match to known workspace members (see below)' : ''}

2. **Meeting Title**: Generate a concise, descriptive title for this meeting based on the main topics discussed.
   - Generate the title in the language specified by code: ${languageCode}
   - Keep it under 60 characters
   - Focus on the main purpose/topic

## Current Speaker Labels
${speakerList}
${memberSection}${notesSection}

## Response Format
Respond ONLY with valid JSON in this exact format (no markdown code blocks, no explanations):
{"speakers": {${examples}}, "title": "Generated meeting title in ${languageCode}"}

You MUST include ALL speaker IDs that are in the "Current Speaker Labels" list above.
For each speaker:
- If you can confidently detect their name from the transcript or meeting notes, provide the name
- If you cannot confidently detect a name, use null
If you cannot determine a good title from the transcript, use null for the title.

## Transcript
${transcript}
`;
}

export function parseSpeakerInferenceResponse(response: string, defaultSpeakers: Record<string, string>): SpeakerInferenceResult | null {
  try {
    const cleanResponse = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed: unknown = JSON.parse(cleanResponse);

    if (!isRecord(parsed)) return null;
    const speakers: Record<string, string> = {};

    if (isRecord(parsed.speakers)) {
      Object.entries(parsed.speakers).forEach(([id, value]) => {
        if (!Object.hasOwn(defaultSpeakers, id) || typeof value !== 'string') return;
        const name = value.trim();

        if (name && !/^(null|unknown)$/i.test(name)) speakers[id] = name;
      });
    }

    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';

    return { speakers, ...(title && title.toLowerCase() !== 'null' && title.length <= 100 ? { title } : {}) };
  } catch {
    return null;
  }
}

export async function inferMeetingSpeakers({
  request,
  transcript,
  defaultSpeakers,
  languageCode,
  notes,
  loadWorkspaceMembers,
  signal,
  timeoutMs = 60_000,
}: {
  request: Pick<WriterRequest, 'fetchAIAssistant'>;
  transcript: string;
  defaultSpeakers: Record<string, string>;
  languageCode: string;
  notes: string;
  loadWorkspaceMembers: () => Promise<readonly { name: string }[]>;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<SpeakerInferenceResult | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();

  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  let rejectAborted: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(new DOMException('Speaker inference cancelled', 'AbortError'));
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
    if (controller.signal.aborted) rejectAborted();
  });

  try {
    const completion = (async () => {
      const workspaceMembers = await loadWorkspaceMembers().catch(() => []);

      if (controller.signal.aborted) return null;
      let response = '';
      const { streamPromise } = await request.fetchAIAssistant({
        inputText: transcript,
        assistantType: AIAssistantType.CustomPrompt,
        ragIds: [],
        completionHistory: [],
        customPrompt: buildSpeakerInferencePrompt({ transcript, defaultSpeakers, languageCode, workspaceMembers, notes }),
        signal: controller.signal,
      }, (text) => { response = text; });

      await streamPromise;
      return controller.signal.aborted ? null : parseSpeakerInferenceResponse(response, defaultSpeakers);
    })();

    return await Promise.race([completion, aborted]);
  } catch {
    // Native inference is best effort: transcript and summary remain usable on AI/network errors.
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAborted);
    controller.abort();
  }
}

/** Recheck current data so a delayed AI response cannot replace a user's edits. */
export function mergeSpeakerInference({
  inference,
  defaultSpeakers,
  currentData,
  speakerLabel,
  defaultTitle,
}: {
  inference: SpeakerInferenceResult;
  defaultSpeakers: Record<string, string>;
  currentData: AIMeetingBlockData;
  speakerLabel: SpeakerLabel;
  defaultTitle: string;
}): Partial<AIMeetingBlockData> {
  const speakerInfoMap = readSpeakerInfoMap(currentData.speaker_info_map);
  const updates: Partial<AIMeetingBlockData> = {};
  let changed = false;

  Object.entries(inference.speakers).forEach(([id, name]) => {
    if (!Object.hasOwn(defaultSpeakers, id)) return;
    const entries = Object.entries(speakerInfoMap).filter(([key]) => getBaseSpeakerId(key) === id);

    // A new custom name entered during inference takes precedence over the AI.
    if (entries.some(([, info]) => !isDefaultSpeakerName(info.name, speakerLabel))) return;
    entries.forEach(([key, info]) => { speakerInfoMap[key] = { ...info, name }; });
    speakerInfoMap[id] = { ...speakerInfoMap[id], name };
    changed = true;
  });

  if (changed) updates.speaker_info_map = JSON.stringify(speakerInfoMap);
  const title = currentData.title?.trim() ?? '';

  if (inference.title && (!title || title === defaultTitle)) updates.title = inference.title;
  return updates;
}
