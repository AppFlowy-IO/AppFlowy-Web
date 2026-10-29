import { createHash } from 'node:crypto';

import { expect, type Page, type Response } from '@playwright/test';

import { livePresentationEnvironment } from './environment';

import type {
  Artifact,
  GenerationRequest,
  JobStatus,
  PresentationStatus,
  ServerSlidePlan,
  SourceEnvelope,
} from '../../src/components/presentation/server-contract';
import type { DeckScene } from '../../src/components/presentation/server-scene';

export const SOURCE_MARKER = 'Expansion requires a separate review of observed outcomes and unresolved risks.';
interface ObservedScene {
  artifactId: string;
  version: number;
  hash: string;
  slideCount: number;
  firstSlideTexts: string[];
}

export interface PresentationObservation {
  method: string;
  path: string;
  status: number;
  code?: number;
  reason?: string;
  request?: Pick<GenerationRequest, 'requestId' | 'task' | 'artifact'> & { count?: number | null; countMode?: string };
  job?: JobStatus;
  artifact?: Artifact<ServerSlidePlan>;
  presentationStatus?: PresentationStatus;
  exportArtifact?: { id: string; version: number };
  source?: { revision: string; pageIds: string[]; blockCount: number; containsMarker: boolean };
  scene?: ObservedScene;
}

/** Observe UI traffic only. Never send requests, inspect authentication or retain source payloads. */
export class PresentationNetwork {
  readonly records: PresentationObservation[] = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly violations = new Set<string>();
  private readonly environment = livePresentationEnvironment();

  constructor(private readonly page: Page) {
    page.on('response', this.onResponse);
  }

  private onResponse = (response: Response) => {
    const url = new URL(response.url());

    if (!url.pathname.startsWith('/api/presentation/')) return;
    const task = this.capture(response, url).catch(() => {
      if (!response.request().failure()?.errorText.includes('ERR_ABORTED')) {
        this.violations.add('A presentation response could not be decoded.');
      }
    });

    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  };

  private async capture(response: Response, url: URL) {
    if (url.origin !== this.environment.webOrigin)
      this.violations.add('Presentation traffic bypassed the verified same-origin Gateway proxy.');
    const prefix = `/api/presentation/${this.environment.workspaceId}/`;

    if (!url.pathname.startsWith(prefix)) this.violations.add('Presentation traffic targeted a different workspace.');
    const record: PresentationObservation = {
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    };

    this.records.push(record);
    if (record.path.endsWith('/exports') || /\/exports\/[^/]+\/download$/.test(record.path)) return;
    // Aborted effect requests and non-JSON proxy errors have no DTO to retain.
    if (!(response.headers()['content-type'] ?? '').includes('json')) return;
    const body = (await response.json()) as { code?: number; reason?: string; data?: unknown };

    record.code = body.code;
    if (typeof body.reason === 'string' && /^[A-Z0-9_]+$/.test(body.reason)) record.reason = body.reason;
    if (body.code !== 0 || !body.data) return;
    if (record.path.endsWith('/status')) record.presentationStatus = body.data as PresentationStatus;
    if (record.path.endsWith('/sources')) {
      const source = body.data as SourceEnvelope;
      const blocks = source.blocks.flatMap(function flatten(block): typeof source.blocks {
        return [block, ...block.children.flatMap(flatten)];
      });

      record.source = {
        revision: source.revision,
        pageIds: source.sources.map((item) => item.pageId),
        blockCount: blocks.length,
        containsMarker: blocks.some((block) => block.text.includes(SOURCE_MARKER)),
      };
    }

    if (/\/artifacts\/[^/]+\/scene$/.test(record.path)) {
      const scene = body.data as DeckScene;

      record.scene = {
        artifactId: record.path.split('/').at(-2)!,
        version: Number(url.searchParams.get('version')),
        hash: createHash('sha256').update(JSON.stringify(scene)).digest('hex'),
        slideCount: scene.slides.length,
        firstSlideTexts:
          scene.slides[0]?.elements.flatMap((element) => (element.kind === 'text' ? [element.text] : [])) ?? [],
      };
    }

    if (/\/(generate|download|jobs\/[^/]+)$/.test(record.path)) record.job = body.data as JobStatus;
    if (/\/artifacts\/[^/]+$/.test(record.path)) {
      const artifact = body.data as Artifact<ServerSlidePlan>;

      if (Array.isArray(artifact.content?.slides)) record.artifact = artifact;
    }

    if (record.path.endsWith('/generate') && record.method === 'POST') {
      const request = response.request().postDataJSON() as GenerationRequest;

      record.request = {
        requestId: request.requestId,
        task: request.task,
        artifact: request.artifact,
        count: request.options.slideCount,
        countMode: request.options.slideCountMode,
      };
    }

    if (record.path.endsWith('/download') && record.method === 'POST') {
      const request = response.request().postDataJSON() as { artifact: { id: string; version: number } };

      record.exportArtifact = { id: request.artifact.id, version: request.artifact.version };
    }
  }

  async job(kind: JobStatus['kind'], after: number): Promise<JobStatus> {
    let terminal: JobStatus | undefined;
    let failure: PresentationObservation | undefined;
    let submitted: JobStatus | undefined;

    await expect
      .poll(
        () => {
          submitted = this.records
            .slice(after)
            .find(
              (r) => r.method === 'POST' && r.path.endsWith(kind === 'export' ? '/download' : '/generate') && r.job
            )?.job;
          terminal = this.records
            .slice(after)
            .map((r) => r.job)
            .find(
              (job) =>
                job?.id === submitted?.id &&
                job?.kind === kind &&
                ['succeeded', 'failed', 'canceled'].includes(job.state)
            );
          failure = this.records
            .slice(after)
            .find(
              (r) =>
                r.method === 'POST' &&
                r.path.endsWith(kind === 'export' ? '/download' : '/generate') &&
                (r.status >= 400 || (r.code !== undefined && r.code !== 0))
            );
          return !!terminal || !!failure;
        },
        { timeout: 360_000, message: `Waiting for the real ${kind} job to finish` }
      )
      .toBe(true);
    if (failure) {
      throw new Error(
        `Presentation ${kind} admission failed: HTTP ${failure.status}, code ${failure.code ?? 'unknown'}, reason ${
          failure.reason ?? 'unspecified'
        }.`
      );
    }

    if (!terminal || terminal.state !== 'succeeded') {
      const reason =
        terminal?.errorReason && /^[A-Z0-9_]+$/.test(terminal.errorReason) ? terminal.errorReason : 'unspecified';

      throw new Error(`Presentation ${kind} job ended as ${terminal?.state ?? 'unknown'} (${reason}).`);
    }

    return terminal;
  }

  async artifact(id: string, version: number, after = 0): Promise<Artifact<ServerSlidePlan>> {
    let result: Artifact<ServerSlidePlan> | undefined;

    await expect
      .poll(
        () => {
          result = this.records
            .slice(after)
            .map((r) => r.artifact)
            .find((a) => a?.id === id && a.version === version);
          return !!result;
        },
        { message: 'Waiting for the UI to read the exact saved artifact version' }
      )
      .toBe(true);
    return result!;
  }

  async status(after = 0): Promise<PresentationStatus> {
    let result: PresentationStatus | undefined;

    await expect
      .poll(
        () => {
          result = this.records
            .slice(after)
            .map((r) => r.presentationStatus)
            .filter(Boolean)
            .at(-1);
          return !!result;
        },
        { message: 'Waiting for authoritative workspace presentation status' }
      )
      .toBe(true);
    return result!;
  }

  async source(pageId: string) {
    let result: PresentationObservation['source'];

    await expect
      .poll(
        () => {
          result = this.records.map((record) => record.source).find((source) => source?.pageIds.includes(pageId));
          return !!result;
        },
        { message: 'Waiting for Cloud to resolve the task-owned source page' }
      )
      .toBe(true);
    return result!;
  }

  async scene(id: string, version: number, after = 0): Promise<ObservedScene> {
    let result: ObservedScene | undefined;

    await expect
      .poll(
        () => {
          result = this.records
            .slice(after)
            .map((record) => record.scene)
            .find((scene) => scene?.artifactId === id && scene.version === version);
          return !!result;
        },
        { message: 'Waiting for the exact saved scene version' }
      )
      .toBe(true);
    return result!;
  }

  async finish() {
    this.page.off('response', this.onResponse);
    await Promise.all(this.pending);
    expect([...this.violations], 'All presentation requests must use the confirmed Gateway and workspace').toEqual([]);
  }

  /** Only this allowlist can be attached to the report; never dump raw DTOs or HTTP headers. */
  evidence() {
    return this.records.map(
      ({ method, path, status, code, reason, job, artifact, presentationStatus, request, source, scene }) => ({
        method,
        path,
        status,
        code,
        reason,
        requestId: request?.requestId,
        request,
        job: job && {
          id: job.id,
          state: job.state,
          kind: job.kind,
          artifactId: job.artifactId,
          resultVersion: job.resultVersion,
          committedUnits: job.committedUnits,
        },
        artifact: artifact && { id: artifact.id, version: artifact.version, slideCount: artifact.content.slides.length },
        usage: presentationStatus && { plan: presentationStatus.plan, ...presentationStatus.usage },
        source,
        scene: scene && {
          artifactId: scene.artifactId,
          version: scene.version,
          hash: scene.hash,
          slideCount: scene.slideCount,
        },
      })
    );
  }
}
