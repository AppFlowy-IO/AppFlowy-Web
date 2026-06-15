@seeded-role-matrix
Feature: Seeded role matrix private page permissions
  The rm0521 role-matrix fixture already exists in the local AppFlowy Cloud database.
  These scenarios verify the web UI behavior for owner, member, guests, and nonmember accounts.

  Background:
    Given the seeded rm0521 role matrix fixture exists

  # Expected result: a private page shared to a guest only lists the owner and that guest.
  # Workspace co-owners, members, other guests, and nonmembers must not appear as inherited full-access users.
  Scenario: Owner private page share panel only lists explicit guest access
    Given I sign in as seeded "owner"
    When I open the seeded "owner guest read private page"
    And I open the share panel
    Then the share panel shows seeded "owner" with "Full access"
    And the share panel shows seeded "guest reader" with "Can view"
    And the share panel does not show seeded "co-owner"
    And the share panel does not show seeded "member"
    And the share panel does not show seeded "guest writer"
    And the share panel does not show seeded "guest no share"
    And the share panel does not show seeded "nonmember"
    And the share panel general access is "Restricted"

  # Expected result: a private page shared to a workspace member lists that member with edit access,
  # without leaking other workspace members or guests into the people-with-access list.
  Scenario: Owner private page share panel lists explicit member access
    Given I sign in as seeded "owner"
    When I open the seeded "owner member write private page"
    And I open the share panel
    Then the share panel shows seeded "owner" with "Full access"
    And the share panel shows seeded "member" with "Can edit"
    And the share panel does not show seeded "co-owner"
    And the share panel does not show seeded "guest reader"
    And the share panel does not show seeded "guest writer"
    And the share panel does not show seeded "guest no share"
    And the share panel does not show seeded "nonmember"
    And the share panel general access is "Restricted"

  # Expected result: a read-only guest can open the explicitly shared private page,
  # sees restricted general access, and cannot edit the page title.
  Scenario: Guest reader can open the shared private page but cannot edit the title
    Given I sign in as seeded "guest reader"
    When I open the seeded "owner guest read private page"
    Then the seeded page title is visible
    And the page title is read-only
    When I open the share panel
    Then the share panel shows seeded "guest reader" with "Can view"
    And the share panel general access is "Restricted"

  # Expected result: a write guest can open and rename the explicitly shared private page.
  Scenario: Guest writer can open and rename the shared private page
    Given I sign in as seeded "guest writer"
    When I open the seeded "owner guest write private page"
    Then the seeded page title is visible
    And the page title is editable
    When I rename the page title to "rm0521 Writer BDD Rename Probe Private Page"
    Then the page title is "rm0521 Writer BDD Rename Probe Private Page"

  # Expected result: a workspace co-owner does not inherit access to another user's unshared private page.
  Scenario: Co-owner cannot open the owner's unshared private page
    Given I sign in as seeded "co-owner"
    When I open the seeded "owner unshared private page"
    Then the no access page is shown

  # Expected result: a normal workspace member does not inherit access to another user's unshared private page.
  Scenario: Member cannot open the owner's unshared private page
    Given I sign in as seeded "member"
    When I open the seeded "owner unshared private page"
    Then the no access page is shown

  # Expected result: a workspace member can open and edit a private page explicitly shared to them.
  Scenario: Member can open the owner private page explicitly shared to them
    Given I sign in as seeded "member"
    When I open the seeded "owner member write private page"
    Then the seeded page title is visible
    And the page title is editable

  # Expected result: a workspace member can open a page in a public space while it is public.
  # After the owner changes that space to Private in the web UI, the same member loses access to
  # the page and sees the no-access screen instead of the private-space content.
  Scenario: Member loses access when a public space becomes private
    Given I sign in as seeded "owner"
    And I create a temporary public space page in the seeded workspace
    When I open the temporary seeded page
    Then the temporary seeded page title is visible
    When I sign in as seeded "member"
    And I open the temporary seeded page
    Then the temporary seeded page title is visible
    When I sign in as seeded "owner"
    And I change the temporary seeded space permission to "Private"
    And I sign in as seeded "member"
    And I open the temporary seeded page
    Then the no access page is shown
    And the temporary seeded space is hidden from the sidebar
    And the temporary seeded page editor is not visible

  # Expected result: a guest with no explicit share cannot open workspace pages or another guest's shared private page.
  Scenario: Guest with no page share cannot open seeded pages
    Given I sign in as seeded "guest no share"
    When I open the seeded "public page"
    Then the no access page is shown
    And the seeded page title is not visible
    When I open the seeded "owner guest read private page"
    Then the no access page is shown

  # Expected result: a user outside the workspace cannot open the seeded workspace public page.
  Scenario: Nonmember cannot open the workspace public page
    Given I sign in as seeded "nonmember"
    When I open the seeded "public page"
    Then the no access page is shown
    And the seeded page title is not visible
