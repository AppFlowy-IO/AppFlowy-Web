import * as Y from 'yjs';

import { compileFirstBodyActions, FirstBodyContribution, hasFirstBodyContent } from './first-body-actions';
import { applyFirstBodyStaging, FirstBodyStaging } from './first-body-staging';

export type FirstBodyPhase = 'editing' | 'publishing' | 'failed' | 'activated' | 'closed';
export interface FirstBodyEditor {
  flushLocalChanges: () => void;
  activateFirstBody?: (doc: Y.Doc) => void;
}
export interface FirstBodyAsyncCommand {
  run: <T>(work: () => T) => T;
  finish: (error?: unknown) => void;
}

/** Owns only one detached draft. No canonical Yjs document or global prototype is patched. */
export class FirstBodyOwner {
  private phase: FirstBodyPhase = 'editing';
  private editor?: FirstBodyEditor;
  private scheduled = false;
  private completing = false;
  private revision = 0;
  private composing = false;
  private reservation?: symbol;
  private runningReservation?: symbol;
  private contribution?: FirstBodyContribution;
  private staging?: FirstBodyStaging;
  private handedOff?: Y.Doc;
  private readonly idleListeners = new Set<() => void>();
  private attached = true;
  private readonly guarded = new WeakSet<object>();

  constructor(
    readonly doc: Y.Doc,
    private readonly callbacks: {
      assertCurrent: () => void;
      assertEditable?: () => void;
      publish: (
        contribution: FirstBodyContribution,
        finish?: (doc: Y.Doc, assertCurrent: () => void, signal?: AbortSignal) => Promise<void>
      ) => Promise<Y.Doc>;
      saveStaging?: (json: string) => Promise<void>;
      onState: (phase: FirstBodyPhase, error?: unknown) => void;
      onActivated: (doc: Y.Doc) => void;
      onClosed?: () => void;
    }
  ) {
    this.guardType(doc.getMap('data'));
    doc.on('update', this.schedule);
  }

  get state() {
    return this.phase;
  }
  get busy() {
    return this.phase !== 'editing' || this.reservation !== undefined;
  }
  get blocksInput() {
    return this.reservation !== undefined || this.phase === 'closed' || (this.phase === 'failed' && !this.contribution);
  }
  get canRetry() {
    return this.phase === 'failed' && this.contribution !== undefined;
  }

  attachEditor(editor: FirstBodyEditor) {
    this.editor = editor;
  }

  assertMutable = () => {
    this.callbacks.assertCurrent();
    this.callbacks.assertEditable?.();
    if (
      (this.phase !== 'editing' && !((this.phase === 'publishing' || this.phase === 'failed') && this.contribution)) ||
      (this.reservation && this.runningReservation !== this.reservation)
    ) {
      throw new Error('The first row-page body is being published.');
    }
  };

  allowSlateMutation(): boolean {
    try {
      this.assertMutable();
      return true;
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  beginComposition() {
    this.assertMutable();
    this.composing = true;
  }

  endComposition() {
    this.composing = false;
    this.idleListeners.forEach((listener) => listener());
    this.schedule();
  }

  /** An accepted asynchronous command owns mutations across awaits, not the mounted component. */
  beginAsync(): FirstBodyAsyncCommand {
    this.assertMutable();
    const token = Symbol('first-body-command');
    const revision = this.revision;

    this.reservation = token;
    this.report();
    return {
      run: <T>(work: () => T): T => {
        if (this.reservation !== token) throw new Error('The row-page command is no longer current.');
        this.callbacks.assertCurrent();
        this.runningReservation = token;
        try {
          return work();
        } finally {
          this.runningReservation = undefined;
        }
      },
      finish: (error?: unknown) => {
        if (this.reservation !== token) return;
        this.reservation = undefined;
        this.idleListeners.forEach((listener) => listener());
        if (error) {
          // Never seal the successful prefix of a command that failed halfway.
          if (this.revision !== revision) this.phase = 'failed';
          this.report(error);
          if (!this.attached) this.close();
          return;
        }

        this.report();
        this.schedule();
      },
    };
  }

  retry = async () => {
    if (this.phase !== 'failed' || !this.contribution) return;
    await this.publish();
  };

  /** Closing a card cannot cancel an already accepted durable command or activate another card. */
  detach() {
    this.editor?.flushLocalChanges();
    this.attached = false;
    if (this.phase === 'editing' && !this.composing) {
      // A completed paste may outlive its card. Keep its editor/draft until its
      // accepted asynchronous command has flushed and reached the journal.
      this.schedule();
    } else if (this.phase !== 'publishing') this.close();
  }

  private report(error?: unknown) {
    if (this.attached) this.callbacks.onState(this.phase, error);
  }

  private schedule = () => {
    this.revision += 1;
    if (this.scheduled || this.completing || this.phase !== 'editing') return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.phase !== 'editing' || this.composing || this.reservation) return;
      this.completing = true;
      try {
        this.assertMutable();
        // Slate defers its Yjs flush. A direct Yjs command can schedule us first;
        // finish that queued Slate batch before observing the complete forest.
        this.editor?.flushLocalChanges();
        if (!hasFirstBodyContent(this.doc)) {
          if (!this.attached) this.close();
          return;
        }

        this.contribution = compileFirstBodyActions(this.doc);
        this.staging = new FirstBodyStaging(this.doc, (json) => {
          void this.callbacks.saveStaging?.(json).catch((error) => this.report(error));
        });
        this.phase = 'publishing'; // Seal synchronously, before journal/network awaits.
        this.report();
        void this.publish();
      } catch (error) {
        this.report(error);
        if (!this.attached) this.close();
      } finally {
        this.completing = false;
      }
    });
  };

  private async publish() {
    if (!this.contribution) return;
    this.phase = 'publishing';
    this.report();
    try {
      this.callbacks.assertCurrent();
      const current = await this.callbacks.publish(this.contribution, this.handoff);

      this.callbacks.assertCurrent();
      if (this.state === 'closed') return;
      this.phase = 'activated';
      if (this.attached) this.callbacks.onActivated(current);
      this.report();
    } catch (error) {
      this.phase = 'failed';
      this.report(error);
    } finally {
      if (!this.attached) this.close();
    }
  }

  private handoff = async (current: Y.Doc, assertCurrent: () => void, signal?: AbortSignal) => {
    if (this.handedOff) {
      assertCurrent();
      this.callbacks.assertCurrent();
      if (this.handedOff !== current) throw new Error('The row-page editor changed before retrying its save.');
      this.editor?.flushLocalChanges();
      return;
    }

    // IME and an accepted upload own complete commands across awaits. The
    // publication's deadline still bounds this wait; no partial command moves.
    if (this.composing || this.reservation)
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.idleListeners.delete(idle); signal?.removeEventListener('abort', abort); };

        const abort = () => { cleanup(); reject(signal?.reason ?? new Error('The row-page publication was cancelled.')); };

        const idle = () => {
          if (this.composing || this.reservation) return;
          cleanup();
          resolve();
        };

        this.idleListeners.add(idle);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    assertCurrent();
    this.callbacks.assertCurrent();
    this.editor?.flushLocalChanges();
    compileFirstBodyActions(this.doc); // Recheck staged owned blocks and upload completion.
    if (this.staging) applyFirstBodyStaging(current, this.staging.json);
    this.staging?.stop();
    // Rebind synchronously after replay. The mounted Slate editor and its
    // selection keep accepting keystrokes while the persistence barrier awaits.
    this.editor?.activateFirstBody?.(current);
    this.handedOff = current;
    this.phase = 'activated';
  };

  private close() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.reservation = undefined;
    this.staging?.stop();
    this.doc.off('update', this.schedule);
    // Retain denial wrappers until the editor releases its stale references.
    // Restoring mutators here would reopen an old async callback's write path.
    this.doc.destroy();
    this.callbacks.onClosed?.();
  }

  private guardType(value: unknown): void {
    if (!(value instanceof Y.Map || value instanceof Y.Array || value instanceof Y.Text)) return;
    // Yjs 14 cannot enumerate an unattached Array. Guard its mutators now and
    // enumerate descendants immediately after the owning insertion integrates it.
    if (value.doc && value instanceof Y.Map) value.forEach((child) => this.guardType(child));
    if (value.doc && value instanceof Y.Array) value.toArray().forEach((child) => this.guardType(child));
    if (this.guarded.has(value)) return;
    this.guarded.add(value);
    const names =
      value instanceof Y.Map
        ? ['set', 'delete', 'clear']
        : value instanceof Y.Array
        ? ['insert', 'delete', 'push', 'unshift']
        : ['insert', 'insertEmbed', 'delete', 'format', 'applyDelta', 'setAttribute', 'removeAttribute'];
    const target = value as unknown as Record<string, (...args: unknown[]) => unknown>;

    for (const name of names) {
      const original = target[name];

      if (typeof original !== 'function') continue;
      target[name] = (...args: unknown[]) => {
        this.assertMutable();
        // New detached child types become guarded before they enter this tree.
        // Preparing an unattached block remains safe and uses normal Yjs APIs.
        for (const arg of args) {
          if (Array.isArray(arg)) arg.forEach((child) => this.guardType(child));
          else this.guardType(arg);
        }

        const result = original.apply(value, args);

        for (const arg of args) {
          if (Array.isArray(arg)) arg.forEach((child) => this.guardType(child));
          else this.guardType(arg);
        }

        return result;
      };
    }
  }
}
