# Native calendar update fixtures

`calendar-yrs.ts` contains base64 Yrs v1 updates produced by `calendar_yrs_fixture.rs`
with the desktop dependency Yrs 0.25.0 and deterministic client ID 1234. These are
actual native updates: Yjs 14 decodes the BigInt values but cannot insert a BigInt
with `Y.Map.set`.

The schema is `data/database/views/calendar/layout_settings/2`. The initial update
contains `layout_ty=1`, `day_count=4`, stale `number_of_days=2`,
`first_day_of_week_v2=2`, and stale `first_day_of_week=0`; all values use `Any::BigInt`.
The subsequent updates change `day_count` to 8 and then 7 (the standard Week view).

To regenerate, compile the fixture generator against the desktop workspace's
pinned Yrs library (replace the library hash with the current build):

```sh
rustc --edition=2024 calendar_yrs_fixture.rs \
  --extern yrs=/path/to/frontend/rust-lib/target/debug/deps/libyrs-HASH.rlib \
  -L dependency=/path/to/frontend/rust-lib/target/debug/deps \
  -o /tmp/calendar-yrs-fixture-generator
/tmp/calendar-yrs-fixture-generator
base64 -i /tmp/calendar-yrs-initial.bin
base64 -i /tmp/calendar-yrs-delta.bin
base64 -i /tmp/calendar-yrs-week-delta.bin
```

Copy the resulting base64 strings into `calendar-yrs.ts`.
