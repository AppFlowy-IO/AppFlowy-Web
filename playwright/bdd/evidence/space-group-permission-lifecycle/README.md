# Workspace permissions: Web review evidence

Screenshots of the workspace permission UI in Web PR #621 after the UX redesign: the Permissions
panel (who can create spaces, access to all spaces), the group dialog, Manage Space (per-person
access and "Who can add pages to this space"), Create space, the account-only page, workspace
creation limits, live loss and recovery of page access, and the sign-out question.

**16 current captures were made on 2026-10-14** from the real Web app against a real Cloud server on
an isolated stack with synthetic data. 15 earlier captures that still match the current UI are kept
and labelled historical; 11 captures of the old UI were removed. Hashes, viewers and the server
state read back after the run are in [capture-manifest.json](capture-manifest.json).

## How the current captures were made

| | |
| --- | --- |
| Date | 2026-10-14 (UTC) |
| Web source | commit `d2c4d938` on `oodrive-fix/web-visual` (integration branch `codex/oodrive-permissions-fixes` at `b612fb90` plus the UI fixes below and the capture spec), served by the vite dev server |
| Server source | AppFlowy Cloud Premium integration branch `codex/oodrive-permissions-fixes` at `bf8f37ef1`, built with `cargo build --locked --bin appflowy_cloud --features commercial-local-test` (self-hosted feature set: three member seats, guests separate) and run with `APPFLOWY_ACCESS_CONTROL=true` |
| Stack | Isolated and synthetic: its own GoTrue (`appflowyinc/gotrue_premium:latest`), Redis, PostgreSQL database and MinIO bucket on loopback ports. No other environment, account or data was used. The Worker was not running (no imports or background jobs are shown). |
| Browser | Chromium 145 (Playwright build 1208), 1440×900, device scale 1. Each person was signed in with a GoTrue password grant stored as the app's session (not through the login screen). Requests to anything but the three stack origins were blocked. |
| Data | Created through the HTTP APIs only (GoTrue admin and Cloud REST) by [the seed](../../../support/permission-gallery-seed.ts). People use `@demo.test` addresses; nothing real is shown. |
| Permission changes | Made by the owner or the operator through the API. Confirmations opened in the UI were cancelled, and no setting was saved from the UI. |

Reproduce on an isolated stack (the seed switches the installation's workspace creation policy, so
it refuses the usual developer ports):

```
APPFLOWY_PERMISSION_GALLERY=1 APPFLOWY_GALLERY_CLOUD=http://127.0.0.1:<cloud> \
APPFLOWY_GALLERY_GOTRUE=http://127.0.0.1:<gotrue> BASE_URL=http://127.0.0.1:<web> \
APPFLOWY_TEST_CHROMIUM_EXECUTABLE=<chromium> \
./node_modules/.bin/playwright test -c playwright.permission-gallery.config.ts
```

[permission-gallery.capture.spec.ts](../../../e2e/app/permission-gallery.capture.spec.ts) is
skipped without those variables. All 7 of its tests passed in the run that produced these images.

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

## Current captures (2026-10-14)

Each caption says what the image shows and what it does not prove. Where the spec asserted
something, that is stated; otherwise the image is only a picture of the UI.

**Permissions, as the owner.** "Who can create spaces" is set to "Owners and selected members";
Alex and the Super_Users group are the selections; the Access to all spaces summary starts below.
The spec checked that this card is the selected one and that both selections are listed.
*Does not prove* that the selections let anyone create a space (the API read back
`can_create_space: true` for Alex and `false` for Sam; see the manifest).

![Permissions as the owner, with the selected members and groups](permissions-owner-selected-members.png)

**Narrowing who can create spaces asks first.** Choosing "Owners only" opened this question; it was
cancelled and the spec checked that the policy stayed "Owners and selected members". *Does not
prove* what saving would do.

![Confirmation before narrowing who can create spaces](permissions-narrowing-confirmation.png)

**Access to all spaces summary.** Groups with access to every current and future public and custom
space (Users, Can view), and the Manage groups button that opens People > Groups. *Read-only*: it
does not show that the coverage applies to a given space.

![Access to all spaces summary in the Permissions panel](permissions-access-to-all-spaces-summary.png)

**Permissions, as a member.** Sam sees "You can't create spaces in this workspace.", the current
policy with every card unavailable, and "Only workspace owners can change this." The spec checked
that the "Owners only" card is disabled. *Does not prove* that the server refuses Sam's request to
create a space (that is covered by server tests, not this run).

![Permissions as a member, read only](permissions-member-read-only.png)

**People > Groups > HR > General, with the Access to all spaces menu open.** Off is ticked; Can view
and Can edit are offered. The menu covers the end of the description while it is open. *Does not
prove* a saved change.

![Group dialog with the Access to all spaces menu open](group-dialog-access-to-all-spaces-menu.png)

**Granting access to all spaces asks first.** Choosing Can edit for HR opened this question; it was
cancelled and the spec checked that the group stayed Off.

![Confirmation before giving HR access to all spaces](group-access-to-all-spaces-confirmation.png)

**Manage Space > Members in a Custom space (HR), with one Access menu open.** Columns Name | Access |
Role. Olivia (space owner) has "Full access" as text; Alex keeps the space default ("Can edit ·
default", ticked in the open menu with Can view, Can comment and Can edit offered); the HR and Users
groups have Can edit and Can view of their own. *Does not prove* that choosing a level saves.

![Manage Space members with the Access menu of Alex open](manage-space-members-access-menu.png)

**The one explanation of per-person access** is the Access column header's tooltip.

![Access column explanation tooltip](manage-space-members-access-explanation.png)

**Where your own extra access comes from.** In Product, Olivia manages the space as the workspace
owner, but her own row is an ordinary member with Can view. Her menu ends with "You can also edit
this space through the Product group." The spec checked that the note names the Product group; the
server reported Olivia's access as Can edit from a group (`workspace_group`).

![Own access menu explaining access through the Product group](manage-space-own-access-explanation.png)

**Manage Space > General in a Custom space (HR), scrolled to the page setting.** Space members Can
edit, everyone else in Demo No access, and "Who can add pages to this space: Only space owners" with
its explanation. At 1440×900 the page setting is below the fold of this dialog, which scrolls.
*Does not prove* that adding a page is refused for members (server and component tests cover that).

![Manage Space General tab with who can add pages](manage-space-general-page-setting.png)

**Create space**, opened by the owner from New page, with a name typed. Public is the default type.
No space was created.

![Create space dialog](create-space.png)

**Workspace menu without permission to create workspaces.** Alex is not selected by the operator:
Create workspace and Import workspace are unavailable, and the tooltip says "Your administrator
hasn't allowed you to create workspaces." The spec checked that the item is marked unavailable and
the tooltip is shown. *Does not prove* that the server refuses a creation request.

![Workspace menu with Create workspace unavailable](workspace-menu-create-workspace-denied.png)

**Signed in without a workspace.** Jordan sees "You're not in a workspace yet", the signed-in
address, the pending invitation to Demo with Join, the reason creation is unavailable, Check again
and Sign out. The API read back an empty workspace list and the pending invitation. *Not tested*:
joining (the invitation was not accepted).

![Account-only page with a pending invitation](account-only-pending-invitation.png)

**An open page loses access when its group's access is removed.** Sam had "Onboarding checklist"
(HR) open; the owner removed the HR group from the HR space through the API. The page shows "No
access to this page" and HR left the sidebar. The spec checked the server answer for Sam
(`can_read: false`), the message, and that the editor was gone.

![Open page after its group access was removed](page-no-access-after-group-removed.png)

**The same page recovers without a reload when access is given back.** The owner restored the HR
group's Can edit through the API. The spec checked `can_write: true`, the page text, and that the
tab was not reloaded (a marker set in the page survived). *Does not prove* that typing is saved (no
edit was made).

![The page after access was given back, without a reload](page-access-restored-after-regrant.png)

**Sign-out question** (Settings > Account & App > Log out) with "Also remove my data from this
browser" and its explanation. Nobody signed out; *does not prove* what is removed.

![Sign-out question with the remove my data option](sign-out-remove-data.png)

## UI fixes made while refreshing the gallery

Found in these captures and fixed test-first before the final run (Web commits on
`oodrive-fix/web-visual`):

- `e7862526` Manage Space's member table: in a wide fallback font the Role menu read "Space mem…" and
  emails were cut ("olivia@de…"). The dialog is now 760px wide and the Role column fits "Space
  member". Groups use the group icon shown everywhere else instead of a letter avatar.
- `005eff66` Sign-out question: the hidden dialog footer left an empty gap under the buttons, and the
  question used "logout" as a verb ("Are you sure you want to log out?").
- `564d200b` Public space card: "Everyone in the Workspace can access" is now in sentence case (the
  French text no longer claims full access).

## Historical captures (still match the current UI)

These were captured on 2026-10-12, before the redesign, against an earlier server build. The page,
"No access to this page" and search views they show were not changed by the redesign (compare
the current captures above and a 2026-10-14 look at the search dialog), so they are kept. They were
not re-run for this refresh.

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
`owner-group-view-assignment.png` (now *Manage Space > Members*); `historical-sidebar-policy.png`
(now *Manage Space > General*); `review-account-only.png` and `historical-account-only.png` (now
*Signed in without a workspace*). They remain in the Git history.

## Feature-to-evidence map

| Feature | Current captures | Automated coverage |
| --- | --- | --- |
| A — per-person access in Custom spaces | Manage Space members, Access explanation, own access explanation | [Manage Space](../../../../src/components/app/view-actions/__tests__/ManageSpace.test.tsx), [copy](../../../../src/components/app/view-actions/__tests__/spaceAccessCopy.test.ts) |
| B — who can create spaces | Permissions as owner and as member, narrowing confirmation, Create space | [Permissions panel](../../../../src/components/app/settings/__tests__/WorkspacePermissionsPanel.test.tsx), [creation capability](../../../../src/components/app/hooks/__tests__/useSpaceCreationCapability.test.tsx) |
| C — access to all spaces | Summary, group dialog menu, grant confirmation | [Group coverage](../../../../src/components/app/settings/__tests__/GroupSpaceCoverageControl.test.tsx), [its menu](../../../../src/components/app/settings/__tests__/GroupSpaceCoverageCard.menu.test.tsx) |
| P — who can add pages | Manage Space > General | [Action gates](../../../../src/components/app/view-actions/__tests__/actionPermissionGates.test.tsx) |
| D — workspace creation limits | Workspace menu, account-only page | [NoWorkspace](../../../../src/components/app/workspaces/__tests__/NoWorkspace.test.tsx), [Workspaces menu](../../../../src/components/app/workspaces/__tests__/Workspaces.creation.test.tsx) |
| R — live permission refresh | Open page loses and regains access | Historical 44-check lifecycle ([spec](../../../e2e/app/space-group-permission-lifecycle.spec.ts)) |
| Sign out | Sign-out question | [LogoutConfirm](../../../../src/components/app/workspaces/__tests__/LogoutConfirm.test.tsx) |

## Limits

- One browser (Chromium), one viewport, English only. No Desktop client, no login screen, no mobile layout.
- Synthetic data on a self-hosted build; the Worker, search and AI services were not running.
- The gallery run changed permissions only through owner and operator API calls; it does not show
  that saving from these controls works (component tests and server tests cover that separately).
- [validation.json](validation.json) records the 2026-10-12 validation of the earlier draft. The
  checks for this refresh are listed in the manifest's `current_capture` section.
- Reproducing the historical lifecycle run needs its private fixture; see
  [the compatibility guide](../../../../doc/web-server-compatibility.md).
