# Web/Desktop row-template compatibility

These tests run the real Desktop Rust SDK and the current Web client against the
same loopback Cloud/GoTrue instance and disposable account. They do not synthesize
the other client's saved format. Every handoff checks workspace, database and
view identity, independently observes the native save in Web, and checks rendered
content after reload and row creation.

The cases cover Web-authored inline/Grid and Board views, and Desktop-authored
archive-only owned and linked databases. The native producer uses the same draft,
archive duplication and row-creation services as Desktop. It checks that owned
copies receive new database IDs and linked copies retain their source database.
The separate Flutter BDD continues to cover the native UI integration.

## Run locally

Start isolated local Cloud/GoTrue dependencies and install Web dependencies. Build
the SDK driver in the Desktop checkout being tested:

```sh
cd /path/to/AppFlowy-Premium/frontend/rust-lib
cargo build --locked -p event-integration-test --example row_template_interop --features dart
```

From this Web checkout:

```sh
BASE_URL=http://127.0.0.1:3089 \
APPFLOWY_BASE_URL=http://localhost:8000 \
APPFLOWY_GOTRUE_BASE_URL=http://localhost:9999 \
APPFLOWY_WS_BASE_URL=ws://localhost:8000/ws/v2 \
APPFLOWY_DESKTOP_INTEROP_BIN=/path/to/AppFlowy-Premium/frontend/rust-lib/target/debug/examples/row_template_interop \
pnpm test:interop:desktop
```

The suite starts and stops its own Vite server and uses one worker with zero
retries. SDK requests travel over stdin; an acknowledgement keeps native sync
alive until Web observes its output. The SDK rejects non-loopback dependencies.
No installed Desktop preferences, `.env` files or user accounts are changed.

## CI

The `template-interop` job in `playwright-test.yml` builds the SDK from Desktop
`main` for ordinary Web changes. Ordinary runs skip it for now, until Desktop
`main` has the SDK driver (#1547) and a Cloud release includes #1504.
Workflow dispatch accepts an exact `desktop_ref`
and `interop_only=true` to validate paired changes before either PR merges.
Desktop's `Web/Desktop template compatibility` workflow dispatches that suite
with its exact PR head SHA and waits for the remote result. A failed remote run
fails the Desktop check; the summary links the paired run.

The reverse path also requires Cloud compound creation with `omit_row_membership`
support. Deploy that server change before Web uses the new materialization path.
Paired interop defaults to a verified, already-built Cloud artifact set matching
the tested Desktop's shared API pins. The CI runtime helper resolves the generated
Client's Server candidate, selects a successful unexpired image build, compares
the generated source, and verifies archive, loaded-image, and actual-container
identities. This avoids accidentally testing a new client against an older
`latest-amd64` image. It never builds or publishes a server.

Dispatch accepts `cloud_source_sha` together with `cloud_image_run_id` to select a
particular existing build. `ci_tools_ref` can pin an immutable CI-tools commit
already merged into AppFlowy-CI `main`. The workflow verifies its ancestry through
GitHub before checking out or executing tools with CI credentials. Both caller and
tools revisions appear in the uploaded `exact-cloud-manifest-template-interop` artifact.

An explicit `cloud_version` selects the published-image path instead; the workflow
resolves its immutable digest and source revision before starting the stack.
Ordinary Web jobs continue using published images. Exact artifact inputs require
`interop_only=true`, and an incomplete pair or mixed selection fails immediately.

Initial delivery requires the companion Web (#679), Desktop (#1547), and Cloud
changes. Validate their exact revisions together; normal runs use peer `main` and
the current verified Cloud image after they land. This adds automatic checks without changing branch-protection settings.
