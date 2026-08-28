@scp0822-space-permissions @mode:serial
Feature: Seeded Public, Private and Custom space permissions
  Workspace owners manage the three space types from the Manage Space modal. A Public space
  follows the workspace (owners get Full access, every other member shares one editable level),
  a Private space has no space roster and is accessible only to its original creator, and a
  Custom space has three audiences: Space owners (Full access), Space members (people and groups,
  one collective level) and everyone else in the workspace (a separate level, possibly No access).
  Pages inside a Private space remain independently shareable. Every scenario restores the seeded
  shape through the API afterwards.

  Background:
    Given the seeded scp0822 space permission fixture exists

  # (a) The Public access card shows the design copy; the workspace members level is editable
  # and applies to every other workspace member.
  Scenario: Owner edits the public workspace members level from the Public access card
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "public space" manage space panel
    Then the Manage Space general tab shows the Public access card
    And the Public access card lists "Workspace owners" with "You and other workspace owners" and "Full access"
    And the Public access card lists "Workspace members" with "All other members in the workspace" and "Can edit"
    And the Manage Space panel has no footer actions
    When I set the Public access workspace members level to "Can view"
    Then the seeded scp0822 "public space" members level is "Can view" via the API
    When I open the seeded scp0822 "public space" manage space panel
    Then the Public access card lists "Workspace members" with "All other members in the workspace" and "Can view"
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "public page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (b) "Switch to Custom" confirms with the PRD copy, then immediately materializes the public
  # roster: workspace owners become Space owners and every
  # other workspace member becomes a Space member.
  Scenario: Switching a Public space to Custom materializes its roster
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "public space" manage space panel
    And I click Switch to Custom in the Public access card
    Then the Manage Space confirmation asks "Change this Space to Custom?" with the action "Change to Custom"
    And the Manage Space confirmation explains "All current Workspace members will remain in this Space. Space owners will keep Full access, and other members will remain Space members with Can edit access. You can customize their access after switching."
    When I confirm the Manage Space dialog
    Then the Manage Space general tab shows the Custom permissions card
    And the Custom permissions card shows Space members "Can edit" and everyone else "Can view"
    And the seeded scp0822 "public space" is "custom" via the API
    When I open the seeded scp0822 "public space" manage space panel
    Then the "Custom" space access card is selected
    And the Manage Space general tab shows the Custom permissions card
    When I open the Manage Space members tab of the open panel
    Then the Manage Space members list shows seeded scp0822 "owner" as "Space owner" with the subtitle "Workspace owner"
    And the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"
    And the Manage Space members list shows seeded scp0822 "outsider" as "Space member" with the subtitle "Workspace member"

  # The type confirmation commits before Members opens, so there is no second apply prompt.
  Scenario: Opening Members after a confirmed switch uses the new Custom roster
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "public space" manage space panel
    And I click Switch to Custom in the Public access card
    And I confirm the Manage Space dialog
    Then the seeded scp0822 "public space" is "custom" via the API
    When I click the Manage Space members tab
    And the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"

  # (c) The Custom permissions card shows the design copy; No access on either audience locks
  # that audience out (and hides the space from everyone else entirely).
  Scenario: Owner locks audiences out of a Custom space with No access
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Manage Space general tab shows the Custom permissions card
    And the Custom permissions card lists "Space owners" with "Can manage this space and its members" and "Full access"
    And the Custom permissions card lists "Space members" with "People and groups added to this space" and "Can edit"
    And the Custom permissions card lists everyone else in the workspace with "Access for other workspace members" and "Can view"
    When I set the Custom permissions everyone else level to "No access"
    Then the seeded scp0822 "custom space" everyone else level is "No access" via the API
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions card shows Space members "Can edit" and everyone else "No access"
    When I sign in as seeded scp0822 "outsider"
    And I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "hidden"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"
    When I sign in as seeded scp0822 "owner"
    And I open the seeded scp0822 "custom space" manage space panel
    And I set the Custom permissions space members level to "No access"
    Then the seeded scp0822 "custom space" members level is "No access" via the API
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions card shows Space members "No access" and everyone else "No access"
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"

  # The page share menu lists explicit principals only. Everyone else remains
  # effective Can view access, represented once under General access instead
  # of expanding every workspace or group member into an individual row.
  Scenario: Custom page share panel separates explicit principals from general access
    Given I sign in as seeded scp0822 "owner"
    When I directly open the seeded scp0822 "custom page"
    And I open the share panel
    Then the share panel shows shared person "scp0822-own@appflowy.local" with "Full access"
    And the share panel shows shared person "scp0822-member@appflowy.local" with "Can edit"
    And the share panel shows shared group "scp0822 Editors" with "Can edit"
    And the share panel does not show shared person "scp0822-editor@appflowy.local"
    And the share panel does not show shared person "scp0822-outsider@appflowy.local"
    And the share panel general access is "Can view"
    When I sign in as seeded scp0822 "outsider"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (d) Removing a listed custom member changes their audience to everyone else (Can view).
  Scenario: Removing a custom member drops them to the everyone-else level
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space members tab
    Then the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"
    When I remove seeded scp0822 "member" from the Manage Space members list
    Then the Manage Space members list does not show seeded scp0822 "member"
    And the seeded scp0822 "custom space" roster does not list seeded scp0822 "member" via the API
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (e) A group added as Space member gives its members the collective Space members level;
  # the Members tab renders it as "Group · N members" with the Space member role.
  Scenario: A group member receives the collective Space members level
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space members tab
    Then the Manage Space members list shows the seeded scp0822 Editors group as "Space member" with "1 member"
    When I sign in as seeded scp0822 "editor"
    And I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "visible"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "editable"
    When the owner sets the seeded scp0822 "custom space" members level to "Can view" via the API
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (f) Custom → Public restores workspace-wide membership; the roster follows the workspace again.
  Scenario: Switching a Custom space to Public opens it to the whole workspace
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    And I choose the "Public" space access card
    Then the Manage Space confirmation asks "Make this Space Public?" with the action "Make Public"
    And the Manage Space confirmation explains "Everyone in the Workspace will be able to access this Space. Workspace members can edit by default, and Workspace owners have Full access. You can change Workspace members’ access to Can view or Full access after switching."
    When I confirm the Manage Space dialog
    Then the Manage Space general tab shows the Public access card
    And the seeded scp0822 "custom space" is "public" via the API
    When I open the seeded scp0822 "custom space" manage space panel
    Then the "Public" space access card is selected
    And the Manage Space general tab shows the Public access card
    When I open the Manage Space members tab of the open panel
    Then the Manage Space members list shows seeded scp0822 "outsider" as "Space member" with the subtitle "Workspace member"
    When I sign in as seeded scp0822 "outsider"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "editable"

  # (f) Custom → Private keeps only the original creator, replaces roster controls with a locked owner row, and
  # revokes inherited space access from every other principal.
  Scenario: Switching a Custom space to Private keeps only the original creator
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    And I choose the "Private" space access card
    Then the Manage Space confirmation asks "Make this Space Private?" with the action "Make Private"
    And the Manage Space confirmation explains "Other Space owners, Space members, and Workspace members will lose access to this Space."
    When I confirm the Manage Space dialog
    Then the seeded scp0822 "custom space" is "private" via the API
    And the Private Manage Space panel shows owner-only access and roster
    When I sign in as seeded scp0822 "member"
    And I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "hidden"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"

  # A true Private space exposes a locked owner-only Members tab instead of collective access.
  # Its creator can still share an individual child page through the Share menu.
  Scenario: The seeded Private space has an owner-only roster and its page remains shareable
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "private space" manage space panel
    Then the "Private" space access card is selected
    And the Private Manage Space panel shows owner-only access and roster
    When I close the Manage Space panel
    And I directly open the seeded scp0822 "private page"
    Then the directly opened seeded scp0822 page is "editable"
    When I open the share panel
    Then the seeded scp0822 Private page sharing controls are enabled

  # (g) Live refresh: the owner changes the collective level over the API while the member's
  # browser stays on the custom page; the server push flips the rendered access in place.
  @live-refresh
  Scenario: Changing the Space members level updates a member's open page live
    Given I sign in as seeded scp0822 "member"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "editable"
    When the owner sets the seeded scp0822 "custom space" members level to "No access" via the API
    Then the open seeded scp0822 page becomes "denied" without reload
    When the owner sets the seeded scp0822 "custom space" members level to "Can edit" via the API
    Then the open seeded scp0822 page becomes "editable" without reload

  # (g) Live refresh: everyone else = No access hides the space from an outsider's sidebar in
  # place, and switching the space type back to Public restores it without a reload.
  @live-refresh
  Scenario: Changing the everyone-else level and the space type updates an outsider's sidebar live
    Given I sign in as seeded scp0822 "outsider"
    When I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "visible"
    When the owner sets the seeded scp0822 "custom space" everyone else level to "No access" via the API
    Then the seeded scp0822 "custom space" space navigation becomes "hidden" without reload
    When the owner switches the seeded scp0822 "custom space" to "public" via the API
    Then the seeded scp0822 "custom space" space navigation becomes "visible" without reload

  # (g) Live refresh: an open Manage Space panel follows a permission change pushed by the
  # server, including the roster refetch that used to trip over an empty 304 body.
  @live-refresh
  Scenario: An open Manage Space panel follows a server-pushed permission change
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions card shows Space members "Can edit" and everyone else "Can view"
    When the owner sets the seeded scp0822 "custom space" members level to "Can view" via the API
    Then the Custom permissions card shows Space members "Can view" and everyone else "Can view" without reload
    When I open the Manage Space members tab of the open panel
    Then the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"

  # (i) PRD §12/§39 Public: the Members tab makes the automatic membership visible — every
  # workspace member is listed with a space role and their workspace role underneath.
  Scenario: The Public Members tab lists every workspace member
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "public space" manage space members tab
    Then the Manage Space members list shows seeded scp0822 "owner" as "Space owner" with the subtitle "Workspace owner"
    And the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"
    And the Manage Space members list shows seeded scp0822 "editor" as "Space member" with the subtitle "Workspace member"
    And the Manage Space members list shows seeded scp0822 "outsider" as "Space member" with the subtitle "Workspace member"

  # (j) PRD §17/§39 Custom General: both collective dropdowns offer all five access levels and
  # Can view and comment applies like any other level.
  Scenario: The collective dropdowns offer every access level including comment-only
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions "space members" dropdown offers every access level
    And the Custom permissions "everyone else" dropdown offers every access level
    When I set the Custom permissions space members level to "Can view and comment"
    Then the seeded scp0822 "custom space" members level is "Can view and comment" via the API
    When I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions card shows Space members "Can view and comment" and everyone else "Can view"
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (k) PRD §37/§39 Safety: the roster refuses to orphan a space — the last Space owner cannot
  # be demoted.
  Scenario: The last Space owner cannot be demoted
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space members tab
    And I demote seeded scp0822 "owner" to Space member in the members list
    Then the last-owner protection error is shown
    And the Manage Space members list shows seeded scp0822 "owner" as "Space owner" with the subtitle "Workspace owner"

  # (l) Collective permission choices are explicit mutations and survive closing the panel.
  Scenario: Permission level changes apply immediately
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    And I set the Custom permissions space members level to "Can view"
    Then the seeded scp0822 "custom space" members level is "Can view" via the API
    When I close the Manage Space panel
    And I open the seeded scp0822 "custom space" manage space panel
    Then the Custom permissions card shows Space members "Can view" and everyone else "Can view"
