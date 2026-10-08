# Background collab repair

A server can request a persisted local copy of a document, database or database row
without opening an editor. Web advertises `background_repair=1` on its workspace
WebSocket. The additive `CollabMessage.repair_request` field (tag 8) supplies an
object/type, request UUID, state vector, optional collab version, payload ceiling,
and, for database objects, database ID and explicit restore-generation UUID.
A nil restore UUID denotes the original generation; absence does not.

The socket owner delivers these notices directly from `onMessage`, so multiple
frames in a React render interval are not lost. A 16-notice buffer covers the
native OPEN-to-React subscription gap; it expires after three seconds and is
cleared when connection ownership, workspace or connection changes. Follower tabs do not perform
repair reads. `useBackgroundCollabRepair` disposes the donor on disconnect,
leadership loss, account/workspace switch or unmount and checks the current outbox
session immediately before enqueueing. The server remains responsible for
permission checks and for deciding whether a candidate actually resolves pending
CRDT dependencies.

## Component boundaries

- `src/application/collab-repair/types.ts` validates and bounds the wire request.
- `indexeddb.ts` reads existing native IndexedDB stores through readonly
  transactions. It never opens a provider, registers a sync context, resets a
  version, migrates storage, compacts updates or starts a network fetch.
- `donor.ts` owns a shared two-reader admission limit, 16 waiting requests, a
  three-second cancellation deadline, request-ID/object deduplication, and a
  finite 128-attempt budget per workspace connection.
- `useBackgroundCollabRepair.ts` routes candidates through the ordinary durable
  outbox with their locally captured version and restore generation. It disables
  sibling broadcasts. Candidates are ordinary updates, not replacement manifest
  snapshots: a persisted copy may lag a newer queued manifest and must not delete
  that manifest during outbox compaction.

The reader reconstructs a temporary Y.Doc from at most 4,096 persisted updates and
8 MiB of encoded source data, then encodes a response capped at the lower of the
server ceiling and 4 MiB. Row snapshots and their update tail are read together
with version/generation metadata in one transaction. The metadata is checked
again after replay; database epochs must agree with the synchronous cross-tab
shadow. Every temporary Doc and IDB connection is closed after the attempt.
The replay loop yields between chunks and checks elapsed time before and after
encoding. The deadline cancels asynchronous storage work; it cannot interrupt one
synchronous Yjs decode/encode operation already executing on the browser thread.

## Provenance and unavailable donors

The collab version must match exactly, including an absent version. Database
roots require their existing generation-specific storage namespace and an exact
persisted aggregate epoch plus localStorage shadow. Rows additionally require
an exact row epoch and a matching database parent inside the reconstructed Doc.
This also applies to the explicit nil/original generation. Untracked legacy
baseline database/row caches are skipped; a request never labels old bytes with
new provenance. Ordinary opening/sync or administrator recovery remains necessary
when no suitable persisted donor exists. Documents do not carry database metadata.

Missing databases are not created. Unsupported types, malformed or oversized
sources, mismatching versions/generations, changed storage, queue exhaustion,
cancellation and missing local copies produce no reply. A reconstructed donor with
pending structs or a pending delete set is skipped, because it cannot supply a
self-contained repair. Its response is still only a repair candidate;
successful send/queueing is not evidence of recovery. The server must
replay and persist a valid, pending-free state before considering recovery
complete. Delete-only updates are preserved even when state vectors match.

## Validation

Run the production component and lifecycle regressions with:

```sh
pnpm exec jest --runInBand --no-coverage src/application/collab-repair src/components/ws/__tests__/useBackgroundCollabRepair.test.ts src/components/ws/__tests__/useAppflowyWebSocket.test.ts
pnpm type-check
```

The component suite uses real Yjs with `fake-indexeddb`'s IndexedDB API
implementation and the production readonly reader, seeded with the actual
snapshot/tail/custom schemas. These are storage component tests, not a real
browser or server recovery demonstration. They cover closed documents/database
roots/rows, missing storage, explicit and untracked generations, row parent and
version fences, missing predecessors, rejected pending structs/delete sets, delete-only
updates, changed epochs, source/response limits and cancellation. Queue tests
exercise shared admission and finite attempts; hook/transport tests exercise
session changes, leadership and bursts delivered without React `lastMessage`.
