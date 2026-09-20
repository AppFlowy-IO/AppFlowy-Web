The web formula result cache reuses successful local calculations in memory. It sits at `evaluateFormulaCell`, so cells, filters, sorts, footers, and type conversions share the same validation. Draft previews and nested evaluations retain their existing evaluation budgets and do not use the result cache.

Desktop persists validated formula results in SQLite. Web uses a bounded cache for each actual database `Y.Doc`: at most 512 entries and an estimated 4 MiB, with entries above 64 KiB skipped. Least recently used entries are evicted. These limits bound retained cache data; eviction only causes recomputation. The cache does not retain row documents. Cached results are copied so a caller cannot mutate another caller's result.

Every read validates the ordered field schema, including names, types, expressions, type options, and field object identities. It then compares the row ID, formula configuration, display formats, and current decoded transitive inputs. Decoding follows the same path as evaluation, including lazy field conversions. Typed fingerprints distinguish values such as negative zero and zero. No timestamp, TTL, or observer version can authorize a hit by itself.

| Change                                             | How the next read stays current                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Local or remote cell edit                          | Current decoded inputs no longer match the entry.                                |
| Nested formula, option label, or format edit       | Exact schema validation replaces the snapshot and invalidates cached results.    |
| Field deletion, rename, retype, or replacement     | Schema content and field identities are checked before reference resolution.     |
| Edit while the view is closed                      | Reopening validates inputs and schema before reusing any value.                  |
| Several edits and reads inside one Yjs transaction | Validation reads live data directly; it does not wait for observer callbacks.    |
| Different database document with the same IDs      | Each `Y.Doc` has a separate cache.                                               |
| Database document destroyed                        | Its destroy listener clears the cache and permanently disables that cache scope. |

Only schemas produced by the schema readers are eligible: those readers retain the source map needed for validation. Manually constructed or copied schema arrays use ordinary evaluation. Errors, oversized results, clock functions, date-sensitive functions or inputs, and people/relation/rollup dependencies are not cached. These exclusions apply through formula chains, including converted cells whose stored source type is date-sensitive or external.

The cache adds no background computation, warmup, timers, or asynchronous writes. Existing React subscriptions stop evaluating when their consumers unmount. A rapid switch can reuse a retained document's cache only after fresh validation; a replacement document starts with its own empty cache. Existing database loading and synchronization determine which collaborative inputs are available—the cache never substitutes an older input snapshot.

IndexedDB is intentionally not part of this implementation. Its [asynchronous API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology) would require an additional memory layer plus ownership checks for late hydration and writes. Yjs persistence [finishing its local load](https://github.com/yjs/y-indexeddb#api) is not proof that remote inputs are current. Browser-restart persistence should be added only if measurements justify that extra state and validation.

Read-time validation also avoids relying on [Yjs observer delivery order](https://docs.yjs.dev/api/y.doc): observers run after a transaction's edits, whereas formula reads can occur during the transaction itself. The cache adds one destroy listener per database and no row listeners, preserving the existing [React subscription cleanup](https://react.dev/reference/react/useSyncExternalStore) ownership.

Regression tests cover cache hits, local and remote edits, transitive/schema changes, conversion and formatting, transaction-time reads, copied schemas, result mutation, eviction, excluded dependencies, first-render freshness after reopen, filtered/sorted footer recovery, and rapid database switching without computation for closed consumers.
