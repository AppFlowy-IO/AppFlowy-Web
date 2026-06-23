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
    When I remove the temporary share-menu group access from the share panel
    Then the temporary share-menu group is not shown in the share panel

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
    When I sign in as seeded spm0622 "member closed" and open the temporary share-menu page
    Then the temporary share-menu page is readable
    And the temporary share-menu page is read only
