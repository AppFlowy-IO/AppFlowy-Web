@space-group-permission @mode:serial
Feature: Seeded space group permission resolution
  A workspace group attached to a space behaves like any other space member with an Owner or
  Member role, and a user who reaches a page through two different groups — one granted on the
  governing space, one shared on the page itself — resolves to the HIGHEST of the two permissions.

  Background:
    Given the seeded stg0822 space group permission fixture exists

  # nathan ∈ group One (space member, Can view) + group Two (page share on Page A, Can edit).
  # Group membership also makes the private space discoverable in the sidebar.
  Scenario: Member of both groups gets the highest permission on the shared page
    Given I sign in as seeded stg0822 "nathan"
    When I open the seeded stg0822 workspace
    Then the seeded stg0822 "group space A" space navigation is "visible"
    When I directly open the seeded stg0822 "group page A"
    Then the directly opened seeded stg0822 page is "editable"
    When I directly open the seeded stg0822 "group page B"
    Then the directly opened seeded stg0822 page is "read-only"

  # reader ∈ group One only: the space-level Can view grant applies to every page.
  Scenario: Member of the space group only can view every page
    Given I sign in as seeded stg0822 "reader"
    When I open the seeded stg0822 workspace
    Then the seeded stg0822 "group space A" space navigation is "visible"
    When I directly open the seeded stg0822 "group page A"
    Then the directly opened seeded stg0822 page is "read-only"
    When I directly open the seeded stg0822 "group page B"
    Then the directly opened seeded stg0822 page is "read-only"

  # outsider is a workspace member outside both groups: the private space stays invisible.
  Scenario: Workspace member outside both groups has no access
    Given I sign in as seeded stg0822 "outsider"
    When I open the seeded stg0822 workspace
    Then the seeded stg0822 "group space A" space navigation is "hidden"
    When I directly open the seeded stg0822 "group page A"
    Then the directly opened seeded stg0822 page is "denied"
    When I directly open the seeded stg0822 "group page B"
    Then the directly opened seeded stg0822 page is "denied"

  # The Manage Space members tab renders the group's role; its access level is verified via API.
  Scenario: Owner sees the group as a space member and the page-level group share
    Given I sign in as seeded stg0822 "owner"
    When I open the seeded stg0822 "group space A" manage space members tab
    Then the Manage Space members list shows seeded stg0822 "group one" with role "Member" and space access "Can view"
    When I directly open the seeded stg0822 "group page A"
    And I open the share panel
    Then the share panel shows seeded stg0822 "group two" with "Can edit"

  # Mutating: the After hook always restores group One to Member / Can view via API.
  Scenario: Owner-role group makes its members space owners
    Given I sign in as seeded stg0822 "owner"
    When I open the seeded stg0822 "group space A" manage space members tab
    And I change the Manage Space role of seeded stg0822 "group one" to "Owner"
    Then the Manage Space members list shows seeded stg0822 "group one" with role "Owner" and space access "Full access"
    When I sign in as seeded stg0822 "reader"
    And I directly open the seeded stg0822 "group page B"
    Then the directly opened seeded stg0822 page is "editable"
    And seeded stg0822 "reader" can manage the seeded stg0822 "group space A"
