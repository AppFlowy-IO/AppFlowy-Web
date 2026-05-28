@public-to-private-move-access
Feature: Public page moved under private page access
  The ptp0527 server-side fixture provides one owner and three workspace members.
  The scenario creates a temporary public page and moves it under the seeded
  private target so fixed membership/share relationships are not mutated.

  Background:
    Given the seeded ptp0527 public-to-private fixture exists

  # Expected result: a public page initially lists all workspace members as implicit Full access.
  # After it moves under a private page shared to member 1, the share panel refreshes to
  # owner plus member 1 only.
  Scenario: Moving a public space page under a private page refreshes access
    Given I sign in as seeded public-to-private "owner"
    And I create a temporary public-to-private public space page
    And I use the seeded public-to-private private target page shared with "member 1"
    When I open the temporary public-to-private movable page
    Then the temporary public-to-private movable page title is visible
    When I open the public-to-private share panel
    Then the public-to-private share panel only shows "owner, member 1, member 2, member 3"
    And the public-to-private share panel shows "owner" with "Full access"
    And the public-to-private share panel shows "member 1" with "Full access"
    And the public-to-private share panel shows "member 2" with "Full access"
    And the public-to-private share panel shows "member 3" with "Full access"
    When I move the temporary public-to-private page under the private target page
    And I open the temporary public-to-private movable page
    And I open the public-to-private share panel
    Then the public-to-private share panel only shows "owner, member 1"
    And the public-to-private share panel shows "owner" with "Full access"
    And the public-to-private share panel shows "member 1" with "Can view"
    And the public-to-private share panel general access is "Restricted"
    When I sign in as seeded public-to-private "member 1"
    And I open the temporary public-to-private movable page
    Then the temporary public-to-private movable page title is visible
    When I sign in as seeded public-to-private "member 2"
    And I open the temporary public-to-private movable page
    Then the public-to-private no access page is shown
