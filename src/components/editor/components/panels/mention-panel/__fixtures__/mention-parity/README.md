# mention-parity

Canonical vectors of the @-mention typeahead contract (`doc/context/workspace/mention_typeahead_contract.md` in AppFlowy-Cloud-Premium). The Cloud copy in `libs/appflowy-entity/fixtures/mention-parity/` is canonical. AppFlowy Web keeps a byte-identical copy in `src/components/editor/components/panels/mention-panel/__fixtures__/mention-parity/`, and AppFlowy Desktop in `frontend/resources/mention-parity/`. All three repositories check the same `FIXTURES.sha256`.

The Rust tests live in `libs/appflowy-entity/src/search/mention_typeahead/` (`parity_tests.rs` runs every vector, `fixture_manifest_tests.rs` checks this folder). They run in the Cloud workspace and in the generated AppFlowy-Client mirror, which carries this folder because it is inside the crate.

## Files

| File | Contents | Checked against |
| --- | --- | --- |
| `normalize.json` | `{id, in, out}`: the normalizer's output, including its traps (final sigma, quotes, `æ`, `ß`, U+0085 and U+FEFF, Hangul Jamo, stripped spacing marks). | `mention_match::normalize` |
| `tiers.json` | `{id, query, title, tier}`: the title tier `T0` to `T3`, or `null` for no title match. `T4` is never a title tier; the ranker assigns it to server items. | `mention_match::title_tier` |
| `people.json` | `{id, query, name, email, class}`: the people class `C0` to `C3`, or `null`. | `mention_match::person_match_class` |
| `rank.json` | `now_ms` and `{id, query, lane, limit?, items, expected}`: the keys `rank_section` returns, in order. | `mention_typeahead::rank_section` |
| `pick-memory.json` | `{id, capacity?, steps}`: picks, scores and use counts replayed on an empty memory. | `mention_typeahead::PickMemory` |
| `merge.json` | `now_ms` and `{id, request, requester?, picks?, local, server, rows_server?, expected}`: merged sections. `request` is the picker's request, before it is split into lanes; its kinds and filter decide which local items may join. `server` and `rows_server` (the rows lane's answer, combined with `server` first) are wire `MentionSearchResponse`s. | `mention_typeahead::combine_lane_answers` and `merge_sections` |
| `schedule.json` | `config` and `{id, server_latency_ms, short_prefix_v1?, rows_lane?, keys, events, requests, typed_groups}`: what the scheduler sends, aborts and receives. | `mention_typeahead::simulate_schedule` |
| `cacheability.json` | `{id, request, current, aborted, response, cacheable}`. | `mention_typeahead::is_cacheable` |
| `request.json` | Deadlines, the `short_prefix_v1` feature name, `query_kinds`, `stream_ids`, `request_times`, `lane_requests` (each request's include list by lane), `refresh_lanes` (the lane that revalidates each lane's answers), `sessions` (requests sent on one session's lanes, and which answers are still current and cacheable) and `stays_local`. | `mention_typeahead::request` and `SessionStreams` |
| `README.md` | This file. | |
| `FIXTURES.sha256` | The manifest. Never edit it by hand. | |

Every JSON file has `version` (the contract version, 1) and `about`. Case `id`s are unique within a file; ports name their test cases by them.

## Conventions

- Keys are navigation keys in their canonical text: `person:<id>`, `page:<id>`, `database:<database_id>:<view_id or ->`, `row:<database_id>:<row_id>`, `date:<title>`, `reminder:<title>`, `link:<url>`. UUIDs are lowercase and hyphenated.
- Lanes are `bare`, `primary`, `rows`, `refresh` and `refresh-rows`.
- Times are integer milliseconds. `used_ago_ms`, `changed_ago_ms` and `ago_ms` count back from the file's `now_ms` (a negative value is a time in the future); an absent one means never.
- Omitted fields take these defaults. `rank.json` items: `email` `""`, `adaptive` `0` (millionths), `lift` `false`, `present` `false`, `used_ago_ms` never, `server_rank` `null` (local-only), `requester` `false`; case `limit` `20`. `merge.json` local items: `email` `""`, `icon` `null`, `changed_ago_ms` and `used_ago_ms` never, `present` `false`; case `requester` `null`, `picks` `[]`, `rows_server` absent. `schedule.json` cases: `short_prefix_v1` and `rows_lane` from `config`. `pick-memory.json` cases: `capacity` `1000`.
- `pick-memory.json` steps: `pick` records `key` for `input`; `score` expects `adaptive` (millionths) and `lift`; `use_count` expects the decayed count in millionths of exactly `input` and `key`, or `null`.
- `request.json` `sessions` steps run on one new session of `client` and `session`: `send` sends a request on `lane` at `now_ms` and expects its `stream_id` and `request_time`; `current` expects whether the `send`-th request (from 0) is still current; `cacheable` expects whether the answer `response` to the `send`-th request, which asked `request`, may be cached, given `aborted`.
- `schedule.json` events are `{t_ms, event, query, lanes}` with `event` one of `send`, `complete`, `abort` and `timeout`, in the order the contract defines for one instant. A typed group's `lanes` are `["primary", "rows"]`, or `["primary"]` when the picker offers no rows; the bare `@` request (query `""`) is `["bare"]`.
- Strings that hold a combining mark are written with `\u` escapes throughout, and so are invisible characters, Hangul Jamo, ligatures and look-alikes (Kelvin, Angstrom and Ohm signs, curly quotes), so no editor or font can change or hide them.

## Byte rules

- UTF-8 without a BOM, LF line endings, exactly one trailing newline, 2-space JSON indentation.
- Every repository marks this folder `text eol=lf` in `.gitattributes`. Nothing formats these files automatically.

## Manifest

`FIXTURES.sha256` lists the SHA-256 of every file in this folder except itself, sorted by path in byte order. Each repository's test recomputes it, compares it with the committed file and prints the expected manifest on failure. Regenerate it from inside this folder (macOS and Linux):

```sh
{ echo '# mention-parity v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md'; \
  find . -type f ! -name FIXTURES.sha256 | sed 's|^\./||' | LC_ALL=C sort | xargs shasum -a 256; } > FIXTURES.sha256
```

## Changing a vector

1. Change the contract and the vectors in AppFlowy-Cloud-Premium first, with the Rust reference, and regenerate the manifest. A change to a rule the server applies (normalization, tiers, classes) ships behind a rollout flag and the MEN-X-04 evaluation gate.
2. Copy the folder byte for byte to AppFlowy-Web and AppFlowy-Premium in one pull request each, with the same `FIXTURES.sha256`, and update their ports until their tests pass.
3. A new rule bumps `version` in every file and the contract version in `mention_typeahead.rs`.
