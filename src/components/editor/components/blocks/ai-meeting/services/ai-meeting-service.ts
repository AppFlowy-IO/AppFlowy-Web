import { AxiosInstance } from 'axios';

import {
  getAccessToken,
  readableStreamToAsyncIterator,
} from '@/components/chat/lib/requets';

import {
  APIResponse,
  CompletionType,
  GenerateSummaryPayload,
  OutputContent,
  OutputLayout,
  StreamResponse,
  StreamType,
  SummaryTemplateResult,
  SummaryTemplateResultRaw,
  TranscriptionOptions,
  TranscriptionResult,
  transformSummaryTemplateResult,
} from './types';

/**
 * Get audio duration from a File object
 */
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();

    audio.onloadedmetadata = () => {
      resolve(Math.ceil(audio.duration));
    };

    audio.onerror = () => {
      reject(new Error('Failed to load audio file'));
    };

    audio.src = URL.createObjectURL(file);
  });
}

export class AIMeetingService {
  constructor(
    private workspaceId: string,
    private axiosInstance: AxiosInstance
  ) {}

  /**
   * Fetch summary templates from the backend
   */
  async getSummaryTemplates(): Promise<SummaryTemplateResult> {
    const url = '/api/meeting/summary_templates';
    const response = await this.axiosInstance.get<APIResponse<SummaryTemplateResultRaw>>(url);

    if (response.data.code === 0 && response.data.data) {
      // Transform raw API response to UI-friendly format
      return transformSummaryTemplateResult(response.data.data);
    }

    throw new Error(response.data.message || 'Failed to fetch summary templates');
  }

  /**
   * Generate AI summary from transcript + notes content (streaming)
   */
  async generateSummary(
    content: string,
    options: {
      customPrompt?: string;
      objectId?: string;
      modelName?: string;
    },
    onMessage: (text: string, done: boolean) => void
  ): Promise<StreamResponse> {
    const baseUrl = this.axiosInstance.defaults.baseURL;
    const url = `${baseUrl}/api/ai/${this.workspaceId}/v2/complete/stream`;
    const token = getAccessToken();

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const cancel = () => {
      void reader?.cancel();
      reader?.releaseLock();
    };

    const payload: GenerateSummaryPayload = {
      text: content,
      completion_type: options.customPrompt ? CompletionType.CustomPrompt : CompletionType.AskAI,
      format: {
        output_content: OutputContent.TEXT,
        output_layout: OutputLayout.Paragraph,
      },
      metadata: {
        object_id: options.objectId || '',
        workspace_id: this.workspaceId,
        rag_ids: options.objectId ? [options.objectId] : [],
        custom_prompt: options.customPrompt ? { system: options.customPrompt } : undefined,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'ai-model': options.modelName || 'Auto',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const streamPromise = (async () => {
      const contentType = response.headers.get('Content-Type');

      // Handle non-streaming JSON response (error case)
      if (contentType?.includes('application/json')) {
        const json = await response.json();

        if (json.code !== 0) {
          throw new Error(json.message || 'Failed to generate summary');
        }

        return;
      }

      reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Failed to get reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';

      const findJsonObjectEnd = (input: string, startIndex: number) => {
        let inString = false;
        let escaped = false;
        let depth = 0;

        for (let i = startIndex; i < input.length; i++) {
          const char = input[i];

          if (escaped) {
            escaped = false;
            continue;
          }

          if (char === '\\') {
            // Escape next character when we're inside a string
            if (inString) {
              escaped = true;
            }

            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (inString) continue;

          if (char === '{') depth++;
          if (char === '}') depth--;

          if (depth === 0) {
            return i;
          }
        }

        return -1;
      };

      try {
        for await (const chunk of readableStreamToAsyncIterator(reader)) {
          buffer += decoder.decode(chunk, { stream: true });

          // Parse JSON objects from buffer
          while (buffer.length > 0) {
            let openBraceIndex = buffer.indexOf('{');

            if (openBraceIndex === -1) break;

            // Trim any leading non-JSON text
            if (openBraceIndex > 0) {
              buffer = buffer.slice(openBraceIndex);
              openBraceIndex = 0;
            }

            const closeBraceIndex = findJsonObjectEnd(buffer, 0);

            if (closeBraceIndex === -1) break;

            const jsonStr = buffer.slice(openBraceIndex, closeBraceIndex + 1);

            try {
              const data = JSON.parse(jsonStr);

              Object.entries(data).forEach(([key, value]) => {
                // Skip metadata and keep-alive messages
                if (key === StreamType.META_DATA || key === StreamType.KEEP_ALIVE_KEY) {
                  return;
                }

                // Accumulate text content
                text += value;
              });

              onMessage(text, false);
            } catch (e) {
              console.error('[AIMeetingService] Failed to parse JSON:', e);
            }

            buffer = buffer.slice(closeBraceIndex + 1);
          }
        }

        // Final callback with done=true
        onMessage(text, true);
      } catch (error) {
        console.error('[AIMeetingService] Stream reading error:', error);
        throw error;
      } finally {
        reader.releaseLock();
        try {
          await response.body?.cancel();
        } catch (error) {
          console.error('[AIMeetingService] Error canceling stream:', error);
        }
      }
    })();

    return { cancel, streamPromise };
  }

  /**
   * Transcribe audio file using backend API
   */
  async transcribeAudio(
    file: File,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const url = `/api/meeting/${this.workspaceId}/transcribe-audio-file`;

    // Get audio duration
    let duration: number;

    try {
      duration = await getAudioDuration(file);
    } catch {
      // If we can't get duration, estimate from file size (rough estimate)
      duration = Math.ceil(file.size / 16000); // Assuming ~16KB per second
    }

    const formData = new FormData();

    formData.append('file', file);
    formData.append('duration', String(duration));

    if (options.model) {
      formData.append('model', options.model);
    }

    if (options.language) {
      formData.append('language', options.language);
    }

    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }

    if (options.temperature !== undefined) {
      formData.append('temperature', String(options.temperature));
    }

    if (options.response_format) {
      formData.append('response_format', options.response_format);
    }

    // For diarization models, chunking strategy is required
    if (options.model === 'gpt-4o-transcribe-diarize') {
      formData.append('chunking_strategy', 'auto');
    }

    const response = await this.axiosInstance.post<APIResponse<TranscriptionResult>>(
      url,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes for long audio files
      }
    );

    if (response.data.code === 0 && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to transcribe audio');
  }
}

export default AIMeetingService;
