# Manifest upload recovery

An open WebSocket does not prove that an individual upload was accepted. In particular,
the server can drop a new row's first full update while write permission is still being
resolved. The local row may remain intact even though automatic database history cannot
capture a durable snapshot of it.

`sync-protocol.ts` starts a context-owned `ManifestRecovery` when a manifest response has
local state to upload. Sending the update or persisting it to the outbox does not clear
that pending work or the HTTP fallback marker. Without another edit or reconnect, it
requests a fresh server manifest after 60 seconds, then backs off to 120, 240 and at most
300 seconds between retries. Repeated responses share the existing deadline. This is
recovery for manifest uploads, not polling after each incremental edit.

Completion requires a server manifest covering the latest local state, with no unresolved
Yjs dependencies and matching collab version and database restore generation. State vectors
do not describe deletions: delete-only diffs require the server's canonical deletion digest.
`delete-set-digest.ts` matches `appflowy-proto::canonical_delete_set_digest` (sorted clients,
coalesced ranges, fixed-width little-endian framing, SHA-256). `collab.proto` uses the
server's existing field numbers; regenerate the JavaScript and declarations with
`pnpm generate-protobuf`. A legacy server without deletion metadata cannot falsely confirm
a delete-only diff; its pending context stays on the bounded retry cadence.

A positive write-access transition wakes pending work. Write denial pauses recovery;
revocation, document destruction, replacement and context cleanup dispose it. Timed sends
require an open transport and the original workspace/account. The restore authority guard
still runs before sending, allows only one pending recovery check per context, and rechecks
transport, permissions, reset state and context identity after awaiting it.

Peer state is not server coverage. Ordinary BroadcastChannel messages continue to exchange
local edits and state vectors, but cannot retire pending uploads. The socket leader also
relays each server manifest as a `server-manifest` control message. Followers use that
message only to confirm coverage, without responding with another upload or forwarding it
back to the server. The existing binary relay is retained for older tabs. A new follower
served by an older leader conservatively retains recovery until it receives authoritative
coverage through a current leader or its own socket.

Recovery belongs to the live sync context. This does not add durable ACK tracking for all
incremental outbox updates, background repair of closed documents, or repair of existing
missing server snapshots. After context teardown, retained IndexedDB state participates in
the normal bind exchange when reopened.

## Catch-up admission and send ownership

`CollabSendWindow` owns flow control on the elected workspace socket, including protocol traffic
relayed by sibling tabs. It sends at most 16 Manifest requests concurrently and coalesces queued
requests to the newest state vector per object. A server Manifest response frees a read slot.
Requests without a response time out after 30 seconds so other objects can progress.

When server-info advertises `supports_realtime_update_ack`, the same socket permits 32 outstanding
update attempts, with one per object and an 8 MiB aggregate payload pacing budget. One individually
valid larger frame may run alone; server frame-size and outbox HTTP-routing limits still apply.
The server's existing protobuf `UpdateAck` (tag 7) retires an attempt in the native message callback,
before React can coalesce renders. A peer update does not free a slot. ACKs must match the database
restore generation and do not establish persistence or convergence.

A full window refuses the send; it does not capture another payload queue. The durable outbox
retains the row and resumes remembered object IDs on ACKs, without scanning IndexedDB for each
response. `OutboxDrainScheduler` allows eight active payload readers and keeps waiting object IDs
only. Fresh edits cannot overtake an older queued drain. Oversized records can still use the existing
HTTP slow lane while WebSocket is offline. Purge, object discard, workspace/account changes and
transport teardown retain their existing generation, ownership and permission fences.

An update without an ACK for 30 seconds stalls the send window and invokes the existing authenticated
reconnect path. It never invents an ACK to admit a causal successor. Replacing the socket URL lets
react-use-websocket close its shared connection; directly calling its protected proxy's `close()`
does not work. Disconnect clears transient reservations and queued reads; reconnect performs the
normal state-vector exchange against retained local state. This does not add durable ACK-based
retirement for incremental rows already handed to the transport.

Older servers that omit the capability keep the existing update behavior; Manifest pacing still
applies. Capability changes take effect at a connection boundary once any legacy update has been
sent, avoiding an old untracked ACK releasing a new reservation. Deploy the Cloud capability and
Web changes together to enable update pacing; legacy clients remain protected by server admission.

## Regression checks

The first-upload test uses the actual `useSync` hook and protocol with real Yjs documents.
It drops the initial full upload, keeps the socket open, and verifies the complete row
reaches the simulated server both with and without a later permission grant. It also checks
that retries stop after convergence. Transport, HTTP, IndexedDB and outbox fixtures are
mocked; this is not a live Cloud/browser end-to-end test.

Additional cases cover retry backoff, offline behavior, deletion loss, unresolved Yjs
dependencies, newer edits, stale version/restore metadata, permissions, teardown, session
changes, cross-tab proof, and authority checks that finish after their context is obsolete.

Direct production-component tests exercise 1500-object Manifest/update bursts with controlled ACK
barriers, bounded drain readers, byte limits, timeout recovery and reservation cleanup. Persistent
outbox cases use real Dexie with fake IndexedDB to check blocked-row retention, ACK resumption and
discard. These are deterministic capacity/correctness tests, not backend throughput measurements.

```bash
pnpm exec jest src/components/ws \
  src/application/realtime src/application/sync-outbox/drain-scheduler.test.ts \
  src/application/services/js-services/__tests__/sync.test.ts \
  src/application/services/js-services/__tests__/manifest-recovery.test.ts \
  src/application/sync-outbox/__tests__ \
  src/components/app/layers/__tests__/AppSyncLayer.test.tsx \
  --runInBand --no-coverage --silent
pnpm type-check
```
