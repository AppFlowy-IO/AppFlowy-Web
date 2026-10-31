/** Maintainer-only endpoints. Authorization is always evaluated by Cloud, including reads. */
import { presentationRequest } from './server-client';

import type { AssessmentInput, Json, ServerSlidePlan, VersionedId } from './server-contract';

export interface PromptComponent {
  version: string;
  text: string;
  checksum: string;
}
export interface PromptBundle {
  version: string;
  components: Record<string, PromptComponent>;
}
export interface ActiveBundle {
  bundleId: string;
  revision: number;
}
export interface ActivePrompts {
  active: ActiveBundle | null;
  bundle: PromptBundle;
}
export interface PromptVersion extends PromptComponent {
  promptKey: string;
  createdAt: string;
  metadata: Json;
}
export interface PromptReference {
  key: string;
  version: string;
}
export interface PromptTest {
  workspaceId: string;
  bundleId: string;
  task: 'assess' | 'mindmap' | 'slides' | 'regenerate_story_plan';
  source: AssessmentInput;
  execute: boolean;
  artifact?: VersionedId;
  storyPlan?: ServerSlidePlan;
  sourceRevision?: string;
}
const base = '/api/admin/presentation';
const keyPath = (key: string) => `${base}/prompts/${encodeURIComponent(key)}`;

export const getActivePrompts = (signal?: AbortSignal) =>
  presentationRequest<ActivePrompts>({ url: `${base}/prompts`, signal });
export const getPromptHistory = (key: string, signal?: AbortSignal) =>
  presentationRequest<PromptVersion[]>({ url: keyPath(key), params: { limit: 30 }, signal });
export const getPromptVersion = (key: string, version: string, signal?: AbortSignal) =>
  presentationRequest<PromptVersion>({ url: `${keyPath(key)}/${encodeURIComponent(version)}`, signal });
export const savePromptVersion = (key: string, text: string) =>
  presentationRequest<PromptVersion>({ url: keyPath(key), method: 'PUT', data: { text, metadata: {} } });
export const savePromptBundle = (components: Record<string, PromptReference>) =>
  presentationRequest<{ id: string }>({ url: `${base}/bundles`, method: 'POST', data: { components, metadata: {} } });
export const getPromptBundle = (id: string, signal?: AbortSignal) =>
  presentationRequest<PromptBundle>({ url: `${base}/bundles/${encodeURIComponent(id)}`, signal });
export const activatePromptBundle = (bundleId: string, expectedRevision: number) =>
  presentationRequest<ActiveBundle>({ url: `${base}/active`, method: 'PUT', data: { bundleId, expectedRevision } });
export const testPromptBundle = (input: PromptTest, signal?: AbortSignal) =>
  presentationRequest<Json>({ url: `${base}/test`, method: 'POST', data: input, signal });
