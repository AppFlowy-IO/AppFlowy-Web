# Verification field

Web and Desktop use native database field type `20` (`19` is Formula).
A field has its ordinary field ID, field order, name, icon and view settings.
Its type option stores the Cloud `property_id` generation; claims, verifier
identity and expiration never enter row cells or the content CRDT.

`native.ts` owns schema binding and guarded lifecycle changes. Explicit
conversion keeps the original field ID, source cells and source type options.
Native calculation settings remain dormant while Cloud settings control the
Verification aggregate. Converting back to the source type restores that data.
Converting out revokes the captured Cloud property generation. Ordinary cell editors, templates and
bulk writes cannot set Verification values.

`VerificationDatabaseValues` watches raw row orders, including rows currently
excluded by filters. It registers authenticated, generation-checked readers
with `external-fields.ts`; linked views independently own their registrations.
The claim and property stores discard dormant authorization and fence obsolete
responses after mutations, permission changes or subscription teardown.
Changing row membership keeps subscriptions for existing rows. Concurrent
subscribers share in-flight reads, and claim versions prevent late actions
from overwriting a newer renewal or removal.

Filters and sorts use the normal Yjs filter tree and ordered sort list. There
is no separate Cloud filter or sort setting and no post-query row projection.
The typed predicate codec in `database-yjs/fields/verification` uses Desktop's
PascalCase enum names and exact signed 64-bit UTC microsecond bounds.

| Snapshot | Empty | Negative predicates | Ascending order |
| --- | --- | --- | --- |
| Unverified | Yes | Evaluated normally | First known status |
| Verified | No | Evaluated normally | Second known status |
| Expired | No | Evaluated normally | Third known status |
| Unknown / unavailable | Unknown | Never matches | Last in both directions |

Within a known status, finite expiration precedes indefinite expiration.
Descending reverses known values only. Expiration bounds are inclusive;
a bounded predicate cannot match an indefinite or unverified snapshot.
Formulas and calculations use the same ephemeral reader and cannot fall back
to cells preserved from an earlier field type.

Grouping and calculation selections remain in Cloud view settings, as on
Desktop. Status grouping cannot be edited by moving cards between groups.
History and templates retain the native schema without loading live claims.

Focused regression tests:

```sh
pnpm exec jest src/application/page-verification src/components/page-verification \
  src/application/database-yjs/__tests__/verification --runInBand --coverage=false
pnpm exec playwright test --config=playwright.integrations.config.ts \
  --project=chromium verification.spec.ts
```

The browser fixture runs production components, Yjs, HTTP readers and query
selectors in an isolated browser context. Cloud responses are simulated; it
does not validate a deployed Cloud service or authorization policies.
