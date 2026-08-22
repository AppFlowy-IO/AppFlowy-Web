@scp0822-space-permissions @mode:serial
Feature: Seeded Public, Private and Custom space permissions
  Workspace owners manage the three space types from the Manage Space modal. A Public space
  follows the workspace (owners get Full access, every other member shares one editable level),
  a Private space only lists explicit members, and a Custom space has three audiences: Space
  owners (Full access), Space members (people and groups, one collective level) and everyone
  else in the workspace (a separate level, possibly No access). Every scenario restores the
  seeded shape through the API afterwards.

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
    When I set the Public access workspace members level to "Can view"
    And I save the Manage Space panel
    Then the seeded scp0822 "public space" members level is "Can view" via the API
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "public page"
    Then the directly opened seeded scp0822 page is "read-only"

  # (b) "Switch to Custom" confirms with the PRD copy, reveals the Custom permissions card and,
  # once saved, materializes the public roster: workspace owners become Space owners and every
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
    When I save the Manage Space panel
    Then the seeded scp0822 "public space" is "custom" via the API
    When I open the seeded scp0822 "public space" manage space members tab
    Then the Manage Space members list shows seeded scp0822 "owner" as "Space owner" with the subtitle "Workspace owner"
    And the Manage Space members list shows seeded scp0822 "member" as "Space member" with the subtitle "Workspace member"
    And the Manage Space members list shows seeded scp0822 "outsider" as "Space member" with the subtitle "Workspace member"

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
    And I save the Manage Space panel
    Then the seeded scp0822 "custom space" everyone else level is "No access" via the API
    When I sign in as seeded scp0822 "outsider"
    And I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "hidden"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"
    When I sign in as seeded scp0822 "owner"
    And I open the seeded scp0822 "custom space" manage space panel
    And I set the Custom permissions space members level to "No access"
    And I save the Manage Space panel
    Then the seeded scp0822 "custom space" members level is "No access" via the API
    When I sign in as seeded scp0822 "member"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"

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
    And the Manage Space confirmation explains "Everyone in the Workspace will be able to access this Space. Space members can edit, and the Space creator and Workspace owners have Full access."
    When I confirm the Manage Space dialog
    Then the Manage Space general tab shows the Public access card
    When I save the Manage Space panel
    Then the seeded scp0822 "custom space" is "public" via the API
    When I sign in as seeded scp0822 "outsider"
    And I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "editable"

  # (f) Custom → Private keeps only the acting owner; other members lose access.
  Scenario: Switching a Custom space to Private keeps only the owner
    Given I sign in as seeded scp0822 "owner"
    When I open the seeded scp0822 "custom space" manage space panel
    And I choose the "Private" space access card
    Then the Manage Space confirmation asks "Make this Space Private?" with the action "Make Private"
    And the Manage Space confirmation explains "Other Space owners, Space members, and Workspace members will lose access to this Space."
    When I confirm the Manage Space dialog
    And I save the Manage Space panel
    Then the seeded scp0822 "custom space" is "private" via the API
    And the seeded scp0822 "custom space" roster does not list seeded scp0822 "member" via the API
    When I sign in as seeded scp0822 "member"
    And I open the seeded scp0822 workspace
    Then the seeded scp0822 "custom space" space navigation is "hidden"
    When I directly open the seeded scp0822 "custom page"
    Then the directly opened seeded scp0822 page is "denied"

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
