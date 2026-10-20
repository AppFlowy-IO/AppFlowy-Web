# Database row template compatibility

Desktop and Web share database `metas` through Yrs/Yjs. Changes to this contract
must be tested in both clients.

## Storage

- `row_templates`: the existing JSON array, retained for older clients and server
  consumers. It also supplies template order and untouched legacy records.
- `row_template_v2:<template_id>`: a JSON record for an individually changed
  template, or the JSON string `null` for a deleted template. Keys live directly
  in `metas` so concurrent first writes cannot replace a newly created child map.
- `row_templates_projection_sha256`: lowercase SHA-256 hex of the exact UTF-8
  `row_templates` string, written in the same transaction as that array.
- `default_row_template`: unchanged; empty means no default.

When the fingerprint matches (or is absent), readers overlay the independent
records on the array, remove tombstones, and append entries missing from the
array in template-ID order. Writers compare against the loaded state and write
only changed entries. Do not eagerly rewrite every template during migration:
two clients upgrading simultaneously must preserve edits to different records.

A mismatched fingerprint identifies an older writer. Its array becomes the
effective state, including deletions. The next upgraded write reconciles the
independent entries against that legacy state before updating the projection.
Refresh the projection after merged edits using record equality, not JSON key
order, so Desktop and Web serializers do not repeatedly rewrite each other.
Desktop repairs it when listing templates; Web repairs it before row/template
duplication, outside React's pure snapshot getter. The existing Web duplication
API flushes collabs before submitting its request to legacy server readers.

Older clients remain readable and sequential older-client edits remain writable.
Concurrent saves involving older clients retain the old whole-array conflict
semantics; the independent-record guarantee requires upgraded writers. Concurrent
edits to the same template and concurrent reorders still use Yrs/Yjs conflict
resolution. Deploy the corresponding Desktop and Web changes together.

## Payload compatibility

Readers accept both typed `default_cells` arrays and legacy field-to-string
objects, including arrays containing records from both versions. Invalid records
must not prevent valid sibling records from loading.

`icon` and `cover` are optional strings. Missing means resolve legacy orphan-view
metadata; empty means explicitly removed. Cover strings contain row-cover JSON:
`data`, numeric `cover_type`, `offset` in [-1, 1], and optional numeric
`upload_type`. Existing Web records omit `upload_type` and denote remote files.
New protobuf fields are optional and appended without changing existing indices.

## Applying templates

An explicit template takes precedence over the default. Otherwise apply the
default unless the caller requests an empty row. Supplied cells (including a
calendar event date) override the corresponding template defaults while keeping
other properties and document content.

Stored document/database snapshots are authoritative. Desktop closes both live
and local preview editing sessions with a final snapshot: cell edits do not change
document blocks. Web flushes pending row/document metadata on close and keeps its
live template source. When using a Desktop snapshot, Web decodes `DocumentDataPB`
into Yjs state before copying or migrating it to an editable live document.
Both clients derive emptiness from saved snapshot content instead of trusting a
stale `is_document_empty` flag. Template-owned databases are copied, while
explicitly linked databases retain their shared source. Legacy snapshots without
an ownership flag retain their existing classification.

Invalid document snapshots fail row creation. Desktop preflights template-owned
database snapshots and removes rows through normal deletion if materialization
fails later. Web publishes row orders only after the duplication request succeeds;
errors propagate before navigation and reciprocal relation updates. Cloud document
duplication still completes asynchronously through the existing worker pipeline.
Property-only legacy templates remain usable without document duplication.

## Cross-client fixtures

`flowy-database2/tests/fixtures/row_template_interop.json` is mirrored in Web's
template test fixtures. It contains base64 Yjs V1 updates emitted by the production
Yrs and Yjs writers from a shared legacy array (`a`, `b`, `d`). Desktop edits `a`
and deletes `d`; Web edits `b` and creates `c`. Tests in both clients apply the
other runtime's update alongside a fresh local edit. The fixture also contains
real Rust `DocumentDataPB` bytes with a formatted paragraph, used by Web's snapshot
decoder, row-creation, template-copy, and editor-migration tests.
