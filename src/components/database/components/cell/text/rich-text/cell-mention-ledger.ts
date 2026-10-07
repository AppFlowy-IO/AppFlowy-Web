import { Log } from '@/utils/log';

type SendMention = (personId: string, requireNotification: boolean) => Promise<boolean>;
const ledgers = new Map<string, CellMentionLedger>();
const MAX_NOTIFICATIONS_PER_FLUSH = 20;

/** An editor can detach while a save is still resolving; the cell owns its intents. */
export function attachCellMentionLedger(key: string, storedPeople: Set<string>) {
  let ledger = ledgers.get(key);

  if (!ledger) {
    ledger = new CellMentionLedger(storedPeople, () => {
      if (ledgers.get(key) === ledger) ledgers.delete(key);
    });
    ledgers.set(key, ledger);
  }

  ledger.attach();
  return ledger;
}

/** Only explicit picker choices that survive confirmed saves can send. */
export class CellMentionLedger {
  private ownAdded = new Set<string>();
  // An explicit later pick may upgrade our earlier record-only delivery.
  private addedHere = new Set<string>();
  private picked = new Map<string, boolean>();
  private sent = new Map<string, boolean>();
  private inFlight = 0;
  private owners = 0;
  private flushRequested = false;
  private idleReady = false;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = Promise.resolve();
  private send?: SendMention;

  constructor(private lastKnown: Set<string>, private onUnused: () => void = () => undefined) {}

  attach() {
    this.owners++;
  }

  detach() {
    this.owners--;
    if (this.owners === 0) void this.flush();
  }

  pick(personId: string, requireNotification: boolean) {
    if (personId) this.picked.set(personId, requireNotification);
  }

  outsideValue(people: Set<string>) {
    this.lastKnown = people;
  }

  beginSave() {
    this.inFlight++;
  }

  saved(people: Set<string>, send: SendMention, idleMs?: number) {
    people.forEach((id) => {
      if (!this.lastKnown.has(id)) {
        this.addedHere.add(id);
        this.ownAdded.add(id);
      }

      if (this.addedHere.has(id) && this.picked.has(id)) this.ownAdded.add(id);
    });
    this.lastKnown = people;
    this.send = send;
    if (idleMs === undefined) {
      this.flushRequested = true;
    } else {
      clearTimeout(this.timer);
      this.idleReady = false;
      this.timer = setTimeout(() => {
        this.idleReady = true;
        void this.flushIfReady();
      }, idleMs);
    }
  }

  finishSave() {
    this.inFlight--;
    void this.flushIfReady();
  }

  flush() {
    this.flushRequested = true;
    return this.flushIfReady();
  }

  private flushIfReady() {
    if (this.inFlight > 0 || (!this.flushRequested && !this.idleReady && this.owners > 0)) return this.sending;
    clearTimeout(this.timer);
    this.flushRequested = this.idleReady = false;
    const recipients = [...this.picked]
      .filter(([id]) => this.ownAdded.has(id) && this.lastKnown.has(id))
      .sort(([a], [b]) => a.localeCompare(b));
    const send = this.send;

    this.ownAdded.clear();
    this.picked.clear();
    const sending = this.sending
      .then(async () => {
        if (!send) return;
        const due = recipients.filter(([id, required]) => {
          const sent = this.sent.get(id);

          return sent !== true && sent !== required;
        });

        if (due.length > MAX_NOTIFICATIONS_PER_FLUSH) {
          Log.warn('[CellMentionLedger] too many notifications; remaining recipients dropped');
        }

        // The recipients are independent of each other: their requests go out
        // together, in sorted order, rather than one round trip after another.
        await Promise.all(
          due.slice(0, MAX_NOTIFICATIONS_PER_FLUSH).map(async ([id, required]) => {
            try {
              if (await send(id, required)) this.sent.set(id, required);
            } catch (error) {
              Log.error('[CellMentionLedger] failed to notify a saved mention', error);
            }
          })
        );
      })
      .finally(() => {
        if (this.sending === sending && this.owners === 0 && this.inFlight === 0) this.onUnused();
      });

    this.sending = sending;
    return sending;
  }
}
