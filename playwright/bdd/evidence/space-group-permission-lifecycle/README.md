# Workspace permissions: Web review evidence

Screenshots and videos of the workspace permission UI in Web PR #621 after the UX redesign: the
Permissions panel (who can create spaces, access to all spaces), the group dialog, Manage space
(access per person and per group, "Who can add pages to this space"), Create space, the
account-only page, workspace creation limits, live loss and recovery of page access, and the
sign-out question.

**Refreshed on 2026-10-15 on the merged code**: Web `b59969d6` (the integration branch after the
merge of main) against server `805c9bab0`. Five [videos](#videos) of the permission flows were
recorded, each a Playwright test whose assertions passed in two consecutive runs. The screenshot
spec ran twice on a freshly seeded stack and 7 of its 8 tests passed: of the 16 earlier images they
took, 14 came out byte for byte the same, one differs only in the date it shows (replaced) and one
in 2 pixels by 1 of 255 (kept), and one capture is new (HR's two groups with their levels). The
first test failed both times: on the merged code the owner's Permissions panel cannot list the
selected members and groups from this server, so its six images were not retaken and still show
the panel before the merge. Two defects of the merged code showed up and are described in
[Merged-code refresh](#merged-code-refresh-2026-10-15); neither is fixed here.

History before the refresh: **22 current captures were made on 2026-10-14** (one retaken on
2026-10-15) from the real Web app against a real Cloud server on an isolated stack with synthetic
data: 21 after a design review of the first refresh (fixes listed below), of which 7 were taken
again and 1 was added later the same day,
after four follow-up fixes that align Web with Desktop (also listed below); a second rerun after the
review of those fixes reproduced two of them byte for byte (also below); a third rerun on 2026-10-15
retook the account-only page against a newer server that sends the invited role, so it now says
"Invited as a guest" (also below). With the refresh there are 23 current captures. 15 earlier
captures that still match the current UI are kept and labelled historical; 11 captures of the old UI
were removed. Hashes, viewers, video files and the server state read back after each run are in
[capture-manifest.json](capture-manifest.json).

## How the current captures were made

| | |
| --- | --- |
| Date | Merged-code refresh and videos: 2026-10-15 (UTC). Before: 2026-10-14 (UTC), and the account-only page retaken on 2026-10-15 (UTC) before the merge; each image's date is in the manifest |
| Web source | Merged-code refresh and videos: app source at `b59969d6` on `oodrive-fix/web-media` (the integration branch `codex/oodrive-permissions-fixes` after the merge of main in `d8cd5643`), with the capture spec, the video spec, the seed and the encoder as committed in `c95f5471` (hashes below), served by the vite dev server. Before the refresh: commit `bcfa8067` on `oodrive-fix/web-visual` (integration branch `codex/oodrive-permissions-fixes` at `b612fb90` plus the UI fixes below and the capture spec), served by the vite dev server. The rerun (the Permissions panel as owner and as member, and the refused Create space) used app source at commit `fde232d7` on `oodrive-fix/web-final` (the integration branch at `31cb5377` plus the four follow-up fixes below) with the capture spec and seed as committed in `3f0ef353` (the commit that also added the retaken images and this record; their hashes are in the manifest, and `fde232d7` alone does not contain them), served the same way. The second rerun (the refused Create space and the account-only page) used commit `8d29f0e3` on `oodrive-fix/web-final` (the above plus the review follow-ups below; app source and harness in that one commit), served the same way. The third rerun (the account-only page) used app source at the integration branch head `ef390b5b` on `oodrive-fix/web-guest-capture`, with the capture spec as committed together with the retaken image and this record, served the same way |
| Server source | Merged-code refresh and videos: AppFlowy Cloud Premium `codex/oodrive-permissions-fixes` at `805c9bab0` (the server PR head), built from a clean checkout with `cargo build --locked -p appflowy-cloud --bin appflowy_cloud --features commercial-local-test` (self-hosted feature set: three member seats, guests separate, restricted workspace creation; dev profile, rustc 1.98.0), binary sha256 `1e7b8c4c498cf1dcbd1e6418fe535fcd5e14b892747c5b7e31bb1d4f1177c3ff`, run with `APPFLOWY_ACCESS_CONTROL=true`; migration ledger at `20261014060432` (293 rows). Before the refresh: AppFlowy Cloud Premium integration branch `codex/oodrive-permissions-fixes` at `59be2954e`. The binary was built at `540757ea9` with `cargo build --locked --bin appflowy_cloud --features commercial-local-test` (self-hosted feature set: three member seats, guests separate); the three commits since then change only tests and docs. Run with `APPFLOWY_ACCESS_CONTROL=true`. The rerun used the same binary (same hash; the stack's build record notes two uncommitted files at build time) while the branch had moved to `6dc8eec23`, whose only source change since (`b11f93934`, database duplicate authorization) does not touch these screens. The third rerun used the integration branch at `e2a01e66c`, whose invitation list sends the invited role, with the same self-hosted feature set: the `appflowy_cloud` executable of `cargo test --no-run --locked --test main --features commercial-local-test` from the branch's validation run (so test fixtures enabled by its dev-dependencies are compiled in, unused by the server; hash in the manifest). The default-feature build of that commit was started first, but a hosted build refuses the seed's installation policy and cannot restrict workspace creation, so nothing was captured with it |
| Harness (refresh and videos) | sha256 of the files as run: capture spec `84708e9376e4…`, video spec `3a28950efa2b…`, seed `a5af8041f82f…`, browser helper `2370e34e2888…`, config `3afb9535c456…`, encoder `6c0fbda7ad9f…` (full values in the manifest's `current_capture.harness` and `videos.harness`) |
| Stack | Isolated and synthetic: its own GoTrue (`appflowyinc/gotrue_premium:latest`), Redis, PostgreSQL database and MinIO bucket on loopback ports. No other environment, account or data was used. The Worker was not running (no imports or background jobs are shown). |
| Browser | Chromium 145 (Playwright build 1208, headless, so scrollbars are hidden), device scale 1: screenshots at 1440×900, videos at 1280×800 with Playwright's slowMo of 200 ms. Each person was signed in with a GoTrue password grant stored as the app's session (not through the login screen), except Jordan in the workspace creation video, who signs in on the login screen. Requests to anything but the three stack origins were blocked. |
| Data | Created through the HTTP APIs only (GoTrue admin and Cloud REST) by [the seed](../../../support/permission-gallery-seed.ts). People use `@demo.test` addresses; nothing real is shown. |
| Permission changes | Screenshots: made by the owner or the operator through the API. Questions opened in the UI were cancelled, lists of people to add were closed, and no setting was saved from the UI (the manifest's read-back shows the policy, the selections, HR's settings and group access unchanged). Videos: Olivia saves two changes from the UI (the Users group's access in HR, who can create spaces) and creates a workspace from the UI; each video's API setup and clean-up are listed with it, and every change is undone and read back in the same test. |

Reproduce on an isolated stack (the seed switches the installation's workspace creation policy, so
it refuses the usual developer ports):

```
APPFLOWY_PERMISSION_GALLERY=1 APPFLOWY_GALLERY_CLOUD=http://127.0.0.1:<cloud> \
APPFLOWY_GALLERY_GOTRUE=http://127.0.0.1:<gotrue> BASE_URL=http://127.0.0.1:<web> \
APPFLOWY_TEST_CHROMIUM_EXECUTABLE=<chromium> \
./node_modules/.bin/playwright test -c playwright.permission-gallery.config.ts permission-gallery

# the videos: the same variables plus APPFLOWY_PERMISSION_VIDEOS=1, then encode them
APPFLOWY_PERMISSION_VIDEOS=1 <the same variables> \
./node_modules/.bin/playwright test -c playwright.permission-gallery.config.ts permission-videos
python3 playwright/support/permission-videos-encode.py <playwright results folder> <output folder>
```

[permission-gallery.capture.spec.ts](../../../e2e/app/permission-gallery.capture.spec.ts) is
skipped without those variables. All 7 of its tests passed in the first run; the rerun ran 3 of its
now 8 tests (with `--grep`), and all 3 passed. The second rerun ran 2 of the 8: the refused Create
space into this folder, and the account-only page into a scratch folder to check its new assertion
against this server; both passed, and both images came out byte for byte the same as the committed
ones, so no image changed. The third rerun ran 1 of the 8, the account-only page, into this folder;
it passed, and only that image changed. The merged-code refresh ran all 8 twice, each time on a
stack reset just before: 7 passed both times and the first failed both times (see below).
[permission-videos.capture.spec.ts](../../../e2e/app/permission-videos.capture.spec.ts) is skipped
unless `APPFLOWY_PERMISSION_VIDEOS=1` is set as well.

## The Demo workspace

| | |
| --- | --- |
| People | Olivia Martin (owner, the only person allowed to create workspaces), Alex Dupont and Sam Leroy (members). Jordan Petit has no workspace and one pending guest invitation to Demo: the three member seats of the self-hosted build are taken. |
| Groups | Users (Olivia, Alex; access to all spaces: Can view), HR (Olivia, Sam), Product (Olivia, Alex, Sam), Super_Users (Alex) |
| Who can create spaces | Owners and selected members: Alex and the Super_Users group |
| Workspace creation (installation) | Selected users; only Olivia is selected |
| General | Public, from the workspace template |
| HR | Custom, owned by Olivia. Space members: Can edit by default; everyone else: No access; only space owners add pages. HR group: Can edit; Users group: Can view; Alex keeps the space default. Sam can reach HR only through the HR group. |
| Product | Custom, created by Alex (a selected space creator). Product group: Can edit. Olivia's own row is an ordinary member with Can view. |
| Leadership | Private, Olivia's |

## Videos

Recorded on 2026-10-15 on the merged code (Web `b59969d6` with the harness of `c95f5471`, server
`805c9bab0`) by [permission-videos.capture.spec.ts](../../../e2e/app/permission-videos.capture.spec.ts).
Each video is one Playwright test on the Demo workspace above, with the same seed, stack and network
guard as the screenshots. Its assertions passed in two consecutive runs on the same database (runs C
and D, 5 of 5 each, 04:55–05:01 UTC); the files here are from the second run.

How they were made:

- One browser window (its own browser context) per person, 1280×800, Chromium 145 headless, with
  Playwright's slowMo of 200 ms and pauses before each step so that each step can be followed.
  Playwright recorded each window (VP8, 25 fps). There is no sound.
- **Overlays drawn by the recording harness, not by the app**: the caption banner at the top (the
  current step in plain words) and the yellow dot that marks the pointer, since headless recordings
  show no cursor. Both are hidden from assistive technology and ignore the pointer; the caption text
  is CSS generated content, so no assertion can match it. Browser spell-check underlines are turned
  off, as for the screenshots.
- [permission-videos-encode.py](../../../support/permission-videos-encode.py) (system ffmpeg 6.1.1)
  joins a test's windows in the order they were on screen: at each moment, the most recently opened
  window that is still open. Each part starts at the next caption shown in its window, so page
  loading is left out, and the video ends when the last window closed. The cut points come from the
  timeline the test wrote, aligned to each recording by the frame where its first caption appears.
  Nothing else is cut, and nothing is sped up, reordered or retouched.
- MP4: libx264, CRF 28, preset slow, yuv420p, faststart, 1280 wide. GIF preview: 8 fps, 960 wide,
  palettegen `stats_mode=diff`, paletteuse `dither=bayer:bayer_scale=5`. No GIF needed a lower frame
  rate or a speed-up. The MP4 has every frame; the GIF can skip a brief state.
- Every change a test makes is undone in the same test and read back through the API. The manifest's
  `videos` section lists each video's checks, captions, windows, cut points and hashes.
- A side-by-side of the reader and editor videos was not made: at 1280 pixels wide each window would
  be shown at half size (the app's text about 7 pixels high), and the two tests differ in length.

### Two groups, two levels in HR

[MP4](videos/groups-two-levels.mp4) · [GIF](videos/groups-two-levels.gif) ·
29.5 s · MP4 348,201 bytes (0.35 MB) · GIF 2,290,214 bytes (2.29 MB, 8 fps) · no speed-up · one window (Olivia)

**Shows:** Olivia (owner) opens Manage space for HR from the sidebar and goes to Members: the HR
group has Can edit and the Users group has Can view. From the Users group's Access menu she chooses
Can comment ("Access updated"; the row says Can comment), then sets it back to Can view; the HR
group keeps Can edit.

**Checked** (in this order, each passed):

- server: the Users group has Can view in HR before the clip
- HR group row shows Can edit
- Users group row shows Can view
- toast "Access updated" after choosing Can comment
- Users group row shows Can comment
- server: the Users group has Can comment (20) in HR
- toast "Access updated" after choosing Can view
- Users group row shows Can view again
- server: the Users group has Can view (10) in HR again
- HR group row still shows Can edit

**Does not prove:** what members of those groups can then do in HR's pages (the next two videos show
one reader and one editor), or how a failed save looks (component tests cover failure toasts).

### A view group reads but cannot edit

[MP4](videos/view-group-reads-only.mp4) · [GIF](videos/view-group-reads-only.gif) ·
18.8 s · MP4 109,772 bytes (0.11 MB) · GIF 1,253,710 bytes (1.25 MB, 8 fps) · no speed-up · one window (Alex)

**Setup and clean-up (owner, API):** Alex's own HR membership is removed first, so he reaches HR only
through the Users group (Can view). Afterwards it is given back at the space default, as seeded, and
read back.

**Shows:** Alex opens Onboarding checklist in HR. The page reads, but there is no title input, no Add
icon or cover buttons over the title and no block handles beside the text. He clicks into the text
and types "Hello", and nothing changes.

**Also on screen, a defect:** at the bottom right, "Changes to 1 page are waiting for edit access.
They're saved on this device. Try again once you can edit, or discard them." appears as the page
opens, before Alex types anything (a caption says so). He made no change. To find out why, the same
view-only session was opened without typing on the stack's previous database, after earlier runs of
the editing test, and the app's sync outbox was read: it held one item for this page, a sync
verification snapshot (`source: manifest`, 22 bytes) that the server had refused because Alex cannot
edit. Its bytes are a Yjs update with no new content, only the page's record of deleted text (the
sentence the editing test adds and removes). Holiday policy, whose history has no deletions, gave no
item and no notice. In run C, where this test ran on a freshly seeded page before the editing test,
the notice did not appear; in run D, after it, it did. So a reader of any page whose history
contains deletions is told he has waiting changes when he has none.

**Checked** (in this order, each passed):

- setup: Alex is no longer a direct member of HR
- setup: the Users group (with Alex in it) has Can view in HR
- server: Alex can read Onboarding checklist but not write it
- the page text is shown
- the editor is read-only (contenteditable is false)
- the title is not editable (no title input)
- no Add icon or cover buttons over the title
- no block handles (add or drag) beside the text
- typing changed nothing on screen
- server: the document has no "Hello"
- teardown: Alex is a direct HR member at the space default again
- teardown: Alex can write Onboarding checklist again

**Does not prove:** comment access (Users has Can view here), or what Alex sees in other spaces.

### An edit group edits, and the edit is kept

[MP4](videos/edit-group-edits.mp4) · [GIF](videos/edit-group-edits.gif) ·
23.5 s · MP4 176,802 bytes (0.18 MB) · GIF 1,445,550 bytes (1.45 MB, 8 fps) · no speed-up · one window (Sam)

**Shows:** Sam, who reaches HR only through the HR group (Can edit), opens Onboarding checklist and
types a sentence under the first line; after a reload the sentence is still there; he then deletes
it and the page is as it was.

**Checked** (in this order, each passed):

- server: Sam can write Onboarding checklist (HR group: Can edit)
- server: Sam is not a direct member of HR
- server: the document does not contain the sentence yet
- the page text is shown
- the editor is editable (contenteditable is true)
- the sentence appears in the page
- server: the document now contains the sentence
- after the reload the sentence is still there
- the sentence is gone from the page
- the original paragraph is unchanged
- server: the document no longer contains the sentence

**Does not prove:** editing by two people at once, offline editing, or that the reload read the
server rather than the browser's copy (the API read is what shows that the server has the sentence).

### Who may create workspaces

[MP4](videos/workspace-creation-control.mp4) · [GIF](videos/workspace-creation-control.gif) ·
37.8 s · MP4 342,061 bytes (0.34 MB) · GIF 2,352,294 bytes (2.35 MB, 8 fps) · no speed-up · three windows, one after another: Sam, Jordan, Olivia

**Shows:** (1) Sam (member) opens the workspace menu: Create workspace and Import workspace are
unavailable, and pointing at each shows "Your administrator hasn't allowed you to create
workspaces." (2) Jordan, who has an account but no workspace, signs in on the login screen with his
email and password and lands on "You're not in a workspace yet", with the reason and his invitation
to Demo, "Invited as a guest". (3) Olivia, the one person the operator allows to create workspaces,
creates "Video demo workspace" from the same menu ("You'll be the owner of the new workspace.") and
lands in it.

**Clean-up (owner, API):** the new workspace is deleted and its absence read back.

**Checked** (in this order, each passed):

- Create workspace is marked unavailable (aria-disabled)
- Import workspace is marked unavailable (aria-disabled)
- Create workspace explains: "Your administrator hasn't allowed you to create workspaces."
- Import workspace explains: "Your administrator hasn't allowed you to create workspaces."
- "You're not in a workspace yet" is shown
- the reason is shown: "Your administrator hasn't allowed you to create workspaces."
- the pending invitation to Demo is shown with "Invited as a guest"
- server: Jordan has no workspace and one pending Guest invitation to Demo
- Create workspace is available to Olivia
- "You'll be the owner of the new workspace." is shown
- the workspace menu now shows the new workspace
- server: Olivia has exactly one new workspace with that name
- the address is in the new workspace
- cleanup: the new workspace is deleted

**Does not prove:** that the server refuses a creation request from Sam or Jordan (only the UI is
shown; server tests cover the API), joining the invitation, or importing.

### The owner narrows who can create spaces

[MP4](videos/space-creation-control.mp4) · [GIF](videos/space-creation-control.gif) ·
39.5 s · MP4 698,673 bytes (0.70 MB) · GIF 4,206,051 bytes (4.21 MB, 8 fps) · no speed-up · two windows: Alex, then Olivia, then Alex again

**Shows:** Alex, a selected space creator, opens New page > Create space and names the space
"Marketing". Meanwhile, in her own window, Olivia (owner) opens Settings > Permissions, chooses
Owners only and confirms the question ("Space creation updated"). Back in Alex's window, Create is
still offered; pressing it rechecks with the server, which refuses: the form gives way to "You can't
create spaces in this workspace." with Close. New page then shows "Create a new space" as
unavailable, with the same reason.

**What the harness held back:** from the moment Olivia's window opened, the harness dropped what the
server pushed to Alex's window (his live connection is relayed), as when the live update arrives
late. Otherwise his dialog would have disabled Create by itself, with the same message. A caption
says so.

**Also on screen, a defect:** in Olivia's panel, "Selected members and groups" shows "We couldn't
load the selected members and groups." with Retry (a caption says so); see
[Merged-code refresh](#merged-code-refresh-2026-10-15).

**Clean-up (owner, API):** the rule is put back to Owners and selected members and read back (Alex
may create spaces again).

**How it was joined:** Alex's window until Olivia's opened, Olivia's window from her first caption
until it closed, then Alex's window again from his next caption. Not shown: Olivia's page loading
(3.9 s), and 21.8 s of Alex's window while hers was open, in which his dialog was left alone (the
spec then checked that Create was still enabled).

**Checked** (in this order, each passed):

- server: owners and selected members may create spaces; Alex may
- server: no space is called Marketing
- Create is enabled for Alex
- Owners and selected members is the current choice
- the question before narrowing is shown
- toast "Space creation updated"
- Owners only is now the selected choice
- server: the policy is Owners only and Alex may not create spaces
- Alex's dialog still offers Create (the live update was held back)
- the answer is shown: "You can't create spaces in this workspace."
- the form and Create are gone; Close is the only action
- Close hides the dialog
- server: no space called Marketing was created
- Create space is disabled in New page
- New page shows the reason: "You can't create spaces in this workspace."
- cleanup: the policy is Owners and selected members again and Alex may create spaces

**Does not prove:** what happens when the live update arrives in time (the dialog disables Create with
the same message; component tests cover it, and the last step shows New page after a fresh check),
or that the selected members and groups are kept for a switch back (only that Alex may create again
once the rule is restored).

## Current captures

Captured on 2026-10-14 unless a caption says otherwise. On 2026-10-15 the merged code reproduced 14
of them byte for byte; one was retaken, one is new, and the six of the owner's Permissions test
could not be retaken (see [Merged-code refresh](#merged-code-refresh-2026-10-15)).

Each caption says what the image shows and what it does not prove. Where the spec asserted
something, that is stated; otherwise the image is only a picture of the UI.

**Permissions, as the owner.** The choices read from the most to the fewest people who can create
spaces, in the Desktop order: Owners and members, Owners and selected members, Owners only. "Who can
create spaces" is set to "Owners and selected members"; Alex and the Super_Users group are the
selections, under "Find members or groups to add". The
panel continues below: a fade over its bottom edge (the Access to all spaces summary) says so. The
spec checked that this card is the selected one and that both selections are listed. *Does not
prove* that the selections let anyone create a space (the API read back `can_create_space: true`
for Alex and `false` for Sam; see the manifest).
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Permissions as the owner, with the selected members and groups](permissions-owner-selected-members.png)

**Add members or groups lists who can be chosen.** Pressed with nothing typed: Sam and the HR,
Product and Users groups are listed under "Not selected"; Alex and Super_Users (already selected),
guests, owners and pending invitations are not. The spec checked Sam and HR are offered, Alex and
Super_Users are not, and that Escape closes the list. Nothing was added.
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Add members or groups listing who can be chosen](permissions-add-members-suggestions.png)

**Narrowing who can create spaces asks first.** Choosing "Owners only" opened this question. It
states the new rule, that the selected members and groups are kept for a switch back, and the
button names the rule ("Use Owners only"). It was cancelled and the spec checked that the policy
stayed "Owners and selected members". *Does not prove* what saving would do.
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Confirmation before narrowing who can create spaces](permissions-narrowing-confirmation.png)

**Access to all spaces summary**, at the end of the panel (no fade). Groups with access to every
current and future public and custom space, and that private spaces and restricted pages are not
included; Users has Can view; the Manage groups button opens People > Groups. *Read-only*: it does
not show that the coverage applies to a given space.
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Access to all spaces summary in the Permissions panel](permissions-access-to-all-spaces-summary.png)

**Permissions, as a member.** Sam sees "You can't create spaces in this workspace." in a callout,
the current policy with every card unavailable (in the same order as for the owner), and "Only
workspace owners can change this." The
spec checked that the "Owners only" card is disabled. *Does not prove* that the server refuses
Sam's request to create a space (that is covered by server tests, not this run).

![Permissions as a member, read only](permissions-member-read-only.png)

**People > Groups > HR > General, with the Access to all spaces menu open.** Off is ticked; Can view
and Can edit are offered. The menu covers the end of the description while it is open. *Does not
prove* a saved change.
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Group dialog with the Access to all spaces menu open](group-dialog-access-to-all-spaces-menu.png)

**Granting access to all spaces asks first.** Choosing Can edit for HR opened this question; it was
cancelled and the spec checked that the group stayed Off.
*Not retaken on the merged code (the owner's Permissions test fails there).*

![Confirmation before giving HR access to all spaces](group-access-to-all-spaces-confirmation.png)

**Manage space · HR > General, as it opens.** The title names the space. The dialog takes the
window's height, so the whole tab fits at 1440×900: space members Can edit, everyone else in Demo
No access, and "Who can add pages to this space: Only space owners" with its explanation. The spec
checked the page setting is fully in view without scrolling and that no "more below" fade shows.
*Does not prove* that adding a page is refused for members (server and component tests cover
that).

![Manage space General tab with who can add pages](manage-space-general-page-setting.png)

**Changing the space type asks first, in sentence case.** Choosing Public in HR opened "Make this
space public?"; it was cancelled and the spec checked that HR stayed Custom (also read back from
the server).

![Question before making HR public](manage-space-type-change-confirmation.png)

**Manage space · HR > Members, with nothing open** (added on 2026-10-15, merged code). The HR group
has **Can edit** and the Users group has **Can view**: two groups with two different levels in the
same space. Olivia (space owner) has "Full access" and Alex keeps the space default ("Can edit ·
default"). The spec checked that the HR row reads "Can edit", the Users row "Can view", and that no
menu and no tooltip was open. *Does not prove* what members of the two groups can do in HR's pages
(the videos [A view group reads but cannot edit](#a-view-group-reads-but-cannot-edit) and
[An edit group edits](#an-edit-group-edits-and-the-edit-is-kept) show one reader and one editor).

![Manage space members: the HR group can edit, the Users group can view](manage-space-groups-view-and-edit.png)

**Manage space · HR > Members, with one Access menu open.** Columns Name | Access | Role; the
headers end where the menus below them end. Olivia (space owner) has "Full access" as text; Alex
keeps the space default ("Can edit · default", ticked in the open menu with Can view, Can comment
and Can edit offered). The open menu covers the HR and Users levels; they show in the next image.
*Does not prove* that choosing a level saves.

![Manage space members with the Access menu of Alex open](manage-space-members-access-menu.png)

**The one explanation of per-person access** is the Access column header's tooltip: "Choose what
each person or group can do in this space, or keep the space default. ..." Here the HR group's Can
edit and the Users group's Can view are visible.

![Access column explanation tooltip](manage-space-members-access-explanation.png)

**Add people or groups lists who can be added.** Pressed with nothing typed: Sam (who reaches HR
only through the HR group) under "Not in space", and Product and Super_Users under "Groups not in
space"; the members list stays below. The spec checked all three are listed and that Escape closes
the list. Nothing was added.

![Add people or groups listing who can be added](manage-space-add-suggestions.png)

**Where your own extra access comes from, with the menu closed.** In Product, Olivia manages the
space as the workspace owner, but her own row is an ordinary member with Can view. An info icon
beside her closed menu says "You can also edit this space through the Product group." The spec
checked the icon's label and the tooltip.

![Info icon beside the closed own access menu](manage-space-own-access-hint.png)

**The same note in the open menu.** Her menu ends with the same line. The spec checked that the
note names the Product group; the server reported Olivia's access as Can edit from a group
(`workspace_group`).

![Own access menu explaining access through the Product group](manage-space-own-access-explanation.png)

**Create space, as it opens** from New page, with a name typed; Public is the default type. A
Public space's settings are taller than the dialog at 1440×900, so a fade over "Who can add pages
to this space" says there is more below (the spec checked the fade is shown). Cancel and Create end
where the cards end. No space was created.

![Create space dialog as it opens](create-space.png)

**Create space, scrolled to the end:** "Who can add pages to this space" in full and no fade (both
checked by the spec).

![Create space scrolled to who can add pages](create-space-page-setting.png)

**Create space refused after the rule changed.** Alex, a selected space creator, opened Create space
from New page and typed "Marketing"; meanwhile the owner narrowed "Who can create spaces" to Owners
only through the API. The capture relays Alex's live connection and held back what the server pushed
from then on, as when the hint about a change arrives late, so the dialog still offered Create.
Pressing it rechecks with the server first, which refused: the form gave way to a summary of the
request (icon, name, type) and the answer "You can't create spaces in this workspace." with "Ask a
workspace owner if you need a new space." and Close as the only action. Nothing is kept: closing
releases the draft. The spec checked that Create was enabled before the change, that the server then
said Alex could not create, the message, the summary, that the name field and Create button were
gone, that Close had keyboard focus (pressed with the mouse here, so no focus ring shows), that Close
hid the dialog and that no Marketing space existed afterwards; the rule was put back
and read back (Alex can create again). *Does not prove* what happens when the hint arrives in time:
the dialog then disables Create with the same message instead (component tests cover both).

![Create space refused: a summary of the request and the answer, with Close](create-space-denied.png)

**Workspace menu without permission to create workspaces.** Alex is not selected by the operator:
Create workspace and Import workspace are unavailable; under the pointer the entry has no fill and a
not-allowed cursor, and the tooltip "Your administrator hasn't allowed you to create workspaces."
opens clear of the menu. The spec checked that the item is marked unavailable and the tooltip is
shown. *Does not prove* that the server refuses a creation request.

![Workspace menu with Create workspace unavailable](workspace-menu-create-workspace-denied.png)

**Signed in without a workspace.** Jordan sees "You're not in a workspace yet", the signed-in
address, "Join a workspace you've been invited to below.", the pending invitation to Demo with Join
and, under "Invited by Olivia Martin", "Invited as a guest", the reason creation is unavailable,
Check again as a text button, and Sign out. Retaken in the third rerun, against a server that sends
the invited role. The spec checked the join line is shown and the "ask a workspace owner" line is
not, that the invitation it read back carries the role `"Guest"`, and that "Invited as a guest" is
shown; the API read back an empty workspace list and the pending guest invitation. *Not tested*:
joining, or what a guest can open after joining.

![Account-only page with a pending invitation](account-only-pending-invitation.png)

**An open page loses access when its group's access is removed.** Sam had "Onboarding checklist"
(HR) open; the owner removed the HR group from the HR space through the API. The page shows "No
access to this page" with balanced lines, HR left the sidebar, and the top bar offers no page
actions. The spec checked the server answer for Sam (`can_read: false`), the message, that the
editor was gone and that there is no Share button.

![Open page after its group access was removed](page-no-access-after-group-removed.png)

**The same page recovers without a reload when access is given back.** The owner restored the HR
group's Can edit through the API. The spec checked `can_write: true`, the page text, that Share is
back, and that the tab was not reloaded (a marker set in the page survived). *Does not prove* that
typing is saved (no edit was made).

![The page after access was given back, without a reload](page-access-restored-after-regrant.png)

**Sign out question** (Settings > Account & App > Sign out) with "Also remove page copies from this
browser" and where unsent changes stay. Behind it, Account & App shows "Set up password" and the
"Sign out" row. Nobody signed out; *does not prove* what is removed. Retaken on the merged code
(2026-10-15): the same screen; only the date in the Date & Time preview behind the question changed.

![Sign out question with the remove page copies option](sign-out-remove-data.png)

## Merged-code refresh (2026-10-15)

The integration branch merged main (`d8cd5643`) and moved on to `b59969d6`. The screenshot spec ran
twice on that code against server `805c9bab0` (04:49 and 05:02 UTC), each time on a stack reset just
before, and 7 of its 8 tests passed both times.

- **The screens of the seven passing tests did not change with the merge.** Every image was compared
  pixel by pixel with the committed one, with the same result in both runs: 14 came out byte for
  byte the same. `sign-out-remove-data.png` differs only in the date in the Date & Time preview
  behind the question (10/14/2026 in the old image, 10/15/2026 on the day of the run; 64 pixels), a
  data difference, so it was retaken. In `permissions-member-read-only.png`, 2 pixels at the
  sidebar edge differ by 1 of 255, which cannot be seen: noise, so it was kept.
  `manage-space-groups-view-and-edit.png` is new.
- **Defect 1: the owner's Permissions panel cannot list the selected members and groups.** The first
  test failed both times at its first check (Alex's row under "Selected members and groups" never
  appeared). Web `20331871` ("fix: reload web caches after a full server restore (#630)", from main)
  adds `server_restore_id` to every request to the Cloud API. Server `805c9bab0` has no such
  parameter, and its list of selected space creators refuses unknown query fields
  (`SpaceCreatorPageQuery` has `#[serde(deny_unknown_fields)]`), so
  `GET /api/workspace/{id}/space-creators?server_restore_id=…&kind=user&limit=200` answers 400
  ("unknown field `server_restore_id`, expected one of `kind`, `after`, `limit`"). The panel then
  shows "We couldn't load the selected members and groups." with Retry (also visible in the video
  [The owner narrows who can create spaces](#the-owner-narrows-who-can-create-spaces)). The six
  images of that test were not retaken and show the panel before the merge:
  `permissions-owner-selected-members.png`,
  `permissions-add-members-suggestions.png`, `permissions-narrowing-confirmation.png`,
  `permissions-access-to-all-spaces-summary.png`, `group-dialog-access-to-all-spaces-menu.png` and
  `group-access-to-all-spaces-confirmation.png`.
- **Defect 2: a reader is told about waiting changes he never made.** A member who can only view a
  page whose history contains deletions sees "Changes to 1 page are waiting for edit access." as the
  page opens: the client queues its sync verification snapshot, the server refuses it because the
  reader cannot edit, and the notice counts it as the reader's changes. Details under
  [A view group reads but cannot edit](#a-view-group-reads-but-cannot-edit).
- **Harness changes** (`c95f5471`): the screenshot and video specs share one browser-session helper
  ([permission-gallery-browser.ts](../../../support/permission-gallery-browser.ts)) with the same
  viewport, network guard, runtime config and stored session as before; the capture spec adds the
  `manage-space-groups-view-and-edit.png` step. The seed's removal of a person's own space membership
  looked for the source `"direct"`, which this server never sends (it sends `manual`, `joined` or
  `creator`, or a derived source), so it never removed anything. It now treats every row that is
  not derived (`workspace_default`, `page_share`, `legacy_private_owner`) as the person's own, as the
  Web client does. On a fresh seed Sam has no such row, so the seeded state is the same.
- Read back after the second run (in the manifest): only selected users may create workspaces
  (Olivia); owners and selected members (Alex and Super_Users) may create spaces; Users covers all
  spaces with Can view; HR is Custom with members at Can edit by default, the HR group at Can edit and
  Users at Can view; Jordan has no workspace and one pending Guest invitation to Demo.

## Follow-up fixes after the Desktop design review (captured in the rerun)

Made test-first on `oodrive-fix/web-final` so Web says and does the same as Desktop:

- `d7327d21` The space creation choices read from the most to the fewest people: Owners and members,
  Owners and selected members, Owners only (narrowing still asks first).
- `a8a269d1` The account-only page adds "Invited as a guest" under an invitation the server marks
  as a guest invitation (captured in the third rerun). What the page reads is `role` on each item of
  `GET /api/workspace/invite?status=Pending`, the invitation's role by name (`"Owner"`, `"Member"` or
  `"Guest"`, spelt as a workspace member's `role` already is); no field, or any other value, adds
  nothing, so a server that sends no role shows no line.
- `9aaec729` Failure toasts in Manage space and People > Groups name the change that failed and give
  a plain reason ("Couldn't change access for Alex. You don't have permission to do this."), with the
  confirmed value kept on screen (not captured; component tests cover them).
- `fde232d7` When the rule refuses a new space on Create, the form gives way to a summary of the
  request and the answer, with Close as the only action, and the draft is released (captured above).

## Review follow-ups (second rerun)

Made test-first on `oodrive-fix/web-final` after an independent review of the fixes above; the two
captures they could touch were run again and came out byte for byte the same:

- `514c4acc` The French toast for a failed change to a group's access to all spaces says whose access
  could not be changed ("l’accès de {{group}} à tous les espaces"); not visible in this English gallery.
- `3b516537` When the rule refuses a new space on Create, Close takes keyboard focus as the card
  appears, so a keyboard or screen reader user does not lose their place; the spec now asserts it
  (no focus ring in the capture, as Create was pressed with the mouse).
- `84b75699` This record named the exact field the "Invited as a guest" line reads, and the spec
  checked the line whenever the server sent the role (none did until the third rerun).
- `967a6c36`, `8d29f0e3` This README and the manifest name the commit that holds the first rerun's
  harness and say that a rerun can differ by a few pixels.

## Guest invitation line (third rerun, 2026-10-15)

The integration branch's invitation list now sends the invited role (server `e2a01e66c`), so the
account-only page was retaken; nothing else was run again.

- The capture spec's account-only test now requires the role `"Guest"` on the invitation it reads
  back and that "Invited as a guest" is shown; a run without the role is no longer noted as waiting
  for the server. The seed already invited Jordan as a guest (and Alex and Sam as members), so it did
  not change.
- Only that image changed: the guest line under "Invited by Olivia Martin"; the taller row moves the
  centred content up 8 px.
- Read back after the run: Jordan's pending invitation to Demo has the role `"Guest"`, Jordan has no
  workspace and may not create one, only selected users may create workspaces, and Demo's members
  are Olivia (Owner), Alex and Sam (Members) and Jordan (pending Guest).

## UI fixes made while refreshing the gallery

Found in these captures or in the design review of the first refresh, and fixed test-first before
the final run (Web commits on `oodrive-fix/web-visual`):

- `f8c5d0a5` Space settings dialogs take the window's height (the tabs were capped at 64% of it), a
  fade shows while more settings are below (also in settings panels), and the footer buttons end
  where the cards end.
- `6927372b` General and Members tabs use the app's tab labels; section headings are larger than
  card and row titles; the Access and Role headers end where their menus end.
- `ce0489b9` "Manage space" in sentence case, with the space's icon and name in the title.
- `efc3a04c` The space type and full access questions are in sentence case.
- `93bbbf20` The Access header tooltip explains the column ("each person or group").
- `7b35e163` An info icon beside your own closed Access menu says where more access comes from.
- `0ae79bbd` The narrowing question states the new rule and that selections are kept ("Use Owners
  only"); the Access to all spaces summary no longer says "open" or points at People > Groups.
- `c9ec5e8b` A member who can't create spaces sees the answer in a callout.
- `e38a7759` Add members or groups (Permissions), Add people or groups (Manage space) and Add members
  (Create space) list who can be added before anything is typed.
- `50691060` The account-only page asks to join a waiting invitation and makes Join the main action.
- `3040909d` The sign-out option says it removes page copies and where unsent changes stay; "Sign
  out" everywhere; "Set up password".
- `02c1976c`, `7af339a6` The reason for an unavailable menu entry opens clear of the menu; the entry
  has no fill under the pointer and keeps the fill for keyboard focus.
- `da77b101` No page actions on a page you can't open; its message has balanced lines.

From the first refresh:

- `e7862526` Manage space's member table: in a wide fallback font the Role menu read "Space mem…" and
  emails were cut ("olivia@de…"). The dialog is now 760px wide and the Role column fits "Space
  member". Groups use the group icon shown everywhere else instead of a letter avatar.
- `005eff66` Sign-out question: the hidden dialog footer left an empty gap under the buttons, and the
  question used "logout" as a verb.
- `564d200b` Public space card: "Everyone in the Workspace can access" is now in sentence case (the
  French text no longer claims full access).

## Historical captures (still match the current UI)

These were captured on 2026-10-12, before the redesign, against an earlier server build. The page,
"No access to this page" and search views they show were not changed by the redesign (compare
the current captures above and a 2026-10-14 look at the search dialog), so they are kept. They were
not re-run for this refresh. One exception in detail: since `da77b101` the "No access to this page"
view has no page actions in its top bar and balances its message, so `grant-removed-primary.png`
and `grant-removed-follower.png` still show the older top bar and line breaks (the current view is
in *An open page loses access when its group's access is removed* above); they are kept for what
the lifecycle run proved.

**Document lifecycle run `cc3e83eb-a782-45bb-b834-3b6c1cf16f7f` (passed, 44 checks).** Three
documents of a separate fixture; owner API calls changed a group grant and a group membership; a
second tab followed the same change; a delayed allowed answer for the revoked document was
delivered and did not bring the content back. Its server build predates the final server review
fixes. Titles are generated fixture names.

| Image | What it showed |
| --- | --- |
| [initial-view-primary.png](initial-view-primary.png) | The primary document with View access (the DOM checks, not the image, established read-only). |
| [explicit-edit-primary-title-focused.png](explicit-edit-primary-title-focused.png) | The same open page after Edit was granted, with its title focused and editable. |
| [grant-removed-primary.png](grant-removed-primary.png) | The primary document denied after its group grant was removed; Shared with me keeps two independently granted documents. |
| [grant-removed-direct.png](grant-removed-direct.png) | A document shared directly stays visible and editable after the same removal. |
| [grant-removed-second.png](grant-removed-second.png) | A document granted through a second group stays editable. |
| [grant-removed-follower.png](grant-removed-follower.png) | A second open tab of the primary document also shows the denial without reloading (same pixels as the primary tab). |
| [final-recovered-view-primary.png](final-recovered-view-primary.png) | The primary document back to View on its original route after the regrant. |

**Search reader runs `e589fbf2-943d-458c-aa13-377b2934b129` and
`8b91758c-b947-4751-9a36-78419e967464` (passed).** Keyword search and recent pages before and after
revocation and regrant, including a held allowed answer delivered after revocation. AI requests were
blocked, so the visible Ask AI entry carries no AI claim. The gallery stack has no search service,
so these were not repeated.

| Image | What it showed |
| --- | --- |
| [historical-body-search-allowed.png](historical-body-search-allowed.png) | A protected body snippet found by keyword search before revocation. |
| [historical-body-search-revoked.png](historical-body-search-revoked.png) | The snippet gone after revocation while a fresh search is pending. |
| [historical-body-search-late-denied.png](historical-body-search-late-denied.png) | No results after an old allowed answer was delivered after revocation. |
| [historical-body-search-regranted.png](historical-body-search-regranted.png) | The snippet back after regrant. |
| [historical-recent-positive.png](historical-recent-positive.png) | The protected page in Recent pages before revocation. |
| [historical-recent-revoked.png](historical-recent-revoked.png) | Recent pages without it after revocation. |
| [historical-recent-late-response-hidden.png](historical-recent-late-response-hidden.png) | Still hidden after an old recent-pages answer was delivered (same pixels as the revoked state). |
| [historical-recent-regranted.png](historical-recent-regranted.png) | Back after regrant. |

## Removed captures of the old UI

Native selects, radio buttons, Save buttons and internal wording that the redesign replaced:
`review-current-creator-controls.png`, `owner-space-creator-settings.png` and
`owner-space-creator-group-settings.png` (now *Permissions, as the owner*);
`review-coverage-off.png`, `review-coverage-view-draft.png`, `review-coverage-edit-draft.png` and
`owner-group-coverage-settings.png` (now the summary, the group dialog menu and its confirmation);
`owner-group-view-assignment.png` (now *Manage space > Members*); `historical-sidebar-policy.png`
(now *Manage space > General*); `review-account-only.png` and `historical-account-only.png` (now
*Signed in without a workspace*). They remain in the Git history.

## Feature-to-evidence map

| Feature | Current captures | Videos | Automated coverage |
| --- | --- | --- | --- |
| A — per-person and per-group access in Custom spaces | Manage space members (nothing open, and with a menu open), Access explanation, add list, own access icon and menu | Two groups, two levels; A view group reads but cannot edit; An edit group edits | [Manage Space](../../../../src/components/app/view-actions/__tests__/ManageSpace.test.tsx), [access menu](../../../../src/components/app/view-actions/__tests__/SpaceMemberAccessControl.menu.test.tsx), [copy](../../../../src/components/app/view-actions/__tests__/spaceAccessCopy.test.ts) |
| B — who can create spaces | Permissions as owner and as member, add list, narrowing confirmation, Create space, Create space refused | The owner narrows who can create spaces | [Permissions panel](../../../../src/components/app/settings/__tests__/WorkspacePermissionsPanel.test.tsx), [copy](../../../../src/components/app/settings/__tests__/WorkspacePermissions.i18n.test.ts), [creation capability](../../../../src/components/app/hooks/__tests__/useSpaceCreationCapability.test.tsx), [Create space](../../../../src/components/app/view-actions/__tests__/CreateSpaceModal.test.tsx) |
| C — access to all spaces | Summary, group dialog menu, grant confirmation | — | [Group coverage](../../../../src/components/app/settings/__tests__/GroupSpaceCoverageControl.test.tsx), [its menu](../../../../src/components/app/settings/__tests__/GroupSpaceCoverageCard.menu.test.tsx) |
| P — who can add pages | Manage space > General, Create space scrolled | — | [Action gates](../../../../src/components/app/view-actions/__tests__/actionPermissionGates.test.tsx), [dialog layout](../../../../src/components/app/view-actions/__tests__/SpaceSettingsPanel.layout.test.tsx) |
| Space type questions | Make this space public? | — | [copy](../../../../src/components/app/view-actions/__tests__/spaceAccessCopy.test.ts) |
| D — workspace creation limits | Workspace menu, account-only page | Who may create workspaces | [NoWorkspace](../../../../src/components/app/workspaces/__tests__/NoWorkspace.test.tsx) (also the guest invitation line), [invitation list](../../../../src/application/services/js-services/http/__tests__/workspace-invitations-api.test.ts), [unavailable entry](../../../../src/components/app/workspaces/__tests__/UnavailableMenuItem.test.tsx), [Workspaces menu](../../../../src/components/app/workspaces/__tests__/Workspaces.creation.test.tsx) |
| R — live permission refresh | Open page loses and regains access | — | Historical 44-check lifecycle ([spec](../../../e2e/app/space-group-permission-lifecycle.spec.ts)), [page actions](../../../../src/components/app/header/__tests__/RightMenu.rowFavorite.test.tsx) |
| Sign out | Sign out question | — | [LogoutConfirm](../../../../src/components/app/workspaces/__tests__/LogoutConfirm.test.tsx) |

## Limits

- One browser (Chromium, headless: scrollbars are hidden), English only, one viewport for the
  screenshots (1440×900) and one for the videos (1280×800). No Desktop client and no mobile layout;
  the login screen appears only in the workspace creation video (Jordan's sign-in).
- The videos are real-time recordings slowed by Playwright's slowMo of 200 ms, with a caption banner
  and a pointer dot drawn by the harness and no sound. Each joins one test's windows as described
  under [Videos](#videos), with no other cut. The GIFs are 8 fps previews; the MP4s have every frame.
- The six images of the owner's Permissions test show the panel before the merge of main: that test
  fails on the merged code against server `805c9bab0` (defect 1 above).
- Running the capture spec again on the same source gives the same screens, but not always the same
  bytes: a few pixels can differ where the pointer happens to rest or in the anti-aliasing of text
  and icons. A hash that differs from the manifest therefore means a fresh capture, not a hand edit
  (no image here was edited by hand); compare the images to judge a change.
- Synthetic data on a self-hosted build; the Worker, search and AI services were not running.
- The screenshot runs changed permissions only through owner and operator API calls; they do not
  show that saving from these controls works. The videos show two saves from the UI (a group's
  access in Manage space, and who can create spaces) and a workspace created from the UI; component
  tests and server tests cover the rest separately.
- The account-only page was retaken against a later server build (`e2a01e66c`) than the other
  current captures, because only that build sends the invited role; no other screen here shows it.
- Failure toasts, which now name the change that failed and give a plain reason, are not captured;
  component tests cover them.
- [validation.json](validation.json) records the 2026-10-12 validation of the earlier draft. The
  checks for this refresh are listed in the manifest's `current_capture` section.
- Reproducing the historical lifecycle run needs its private fixture; see
  [the compatibility guide](../../../../doc/web-server-compatibility.md).
