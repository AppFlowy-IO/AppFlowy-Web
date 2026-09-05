@share-group-invite
Feature: Share menu group invite
  Workspace owners can share a page with a workspace group from the share invite search.

  Scenario: Owner shares a page with a workspace group from invite search
    Given I sign in as seeded spm0622 "owner 1"
    When I create a temporary share-menu document page
    And I create a temporary share-menu group
    And I open the share panel
    And I search the share invite input for the temporary share-menu group
    Then the share invite suggestions show the temporary share-menu group
    When I invite the temporary share-menu group from the share panel
    Then the share panel shows the temporary share-menu group with "Can view"
    When I expand the temporary share-menu group in the share panel
    Then the expanded temporary share-menu group has no members
    When I collapse the temporary share-menu group in the share panel
    Then the temporary share-menu group members are hidden
    When I remove the temporary share-menu group access from the share panel
    Then the temporary share-menu group is not shown in the share panel

  Scenario: Owner invites a person and a group in a single send
    Given I sign in as seeded spm0622 "owner 1"
    When I create a temporary share-menu document page
    And I create a temporary share-menu group
    And I open the share panel
    And I tag seeded spm0622 "member closed" in the share invite input
    And I tag the temporary share-menu group in the share invite input
    And I send the share panel invites
    Then the share panel shows the temporary share-menu group with "Can view"
    And the share panel shows shared person "spm0622-member-restricted@appflowy.local" with "Can view"

  Scenario: Group member can read a private-space page shared to their group
    Given I sign in as seeded spm0622 "owner 1"
    And I create a temporary private-space share-menu page
    And I create a temporary share-menu group with seeded spm0622 "member closed"
    When I sign in as seeded spm0622 "member closed" and cannot open the temporary share-menu page
    When I sign in as seeded spm0622 "owner 1" and open the temporary share-menu page as owner
    And I open the share panel
    And I search the share invite input for the temporary share-menu group
    Then the share invite suggestions show the temporary share-menu group
    When I invite the temporary share-menu group from the share panel
    Then the share panel shows the temporary share-menu group with "Can view"
    When I expand the temporary share-menu group in the share panel
    Then the expanded temporary share-menu group lists seeded spm0622 "member closed"
    And seeded spm0622 "member closed" is listed only inside the temporary share-menu group
    When I collapse the temporary share-menu group in the share panel
    Then the temporary share-menu group members are hidden
    When I sign in as seeded spm0622 "member closed" and open the temporary share-menu page
    Then the temporary share-menu page is readable
    And the temporary share-menu page is read only
    When I open the share panel
    Then the share panel shows the temporary share-menu group with "Can view"
    And the temporary share-menu group cannot be expanded in the share panel

  Scenario: Group-only member is folded under the group on a structured private page
    Given I sign in as seeded spm0622 "owner 1"
    And I create a temporary structured private-space share-menu page
    And I create a temporary share-menu group with seeded spm0622 "member closed"
    When I open the temporary share-menu page as owner
    And I open the share panel
    And I search the share invite input for the temporary share-menu group
    Then the share invite suggestions show the temporary share-menu group
    When I invite the temporary share-menu group from the share panel
    Then the share panel shows the temporary share-menu group with "Can view"
    When I expand the temporary share-menu group in the share panel
    Then the expanded temporary share-menu group lists seeded spm0622 "member closed"
    And seeded spm0622 "member closed" is listed only inside the temporary share-menu group
    When I sign in as seeded spm0622 "member closed" and open the temporary share-menu page
    Then the temporary share-menu page is readable
    And the temporary share-menu page is read only
