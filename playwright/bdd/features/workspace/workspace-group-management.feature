@workspace-group-management
Feature: Workspace group management
  Workspace owners can manage groups, while workspace members can view group summaries from People settings.

  Background:
    Given the seeded spm0622 space permission fixture exists

  Scenario: Owner adds and removes a group member, then deletes a temporary group
    Given I sign in as seeded spm0622 "owner 1"
    When I open the People settings groups tab
    And I create a temporary workspace group
    And I open the temporary workspace group
    And I add workspace member "spm0622-member-restricted@appflowy.local" to the temporary group
    Then the temporary group shows workspace member "spm0622-member-restricted@appflowy.local"
    When I remove workspace member "spm0622-member-restricted@appflowy.local" from the temporary group
    Then the temporary group does not show workspace member "spm0622-member-restricted@appflowy.local"
    When I delete the temporary workspace group
    Then the temporary workspace group is not listed

  Scenario: Workspace member sees an owner-created group without management controls
    Given I sign in as the Nathan workspace owner
    When I open the People settings groups tab
    And I create a temporary workspace group
    And I open the temporary workspace group
    And I add workspace member "eva@appflowy.io" to the temporary group
    Then the temporary group shows workspace member "eva@appflowy.io"
    When I sign in as Eva and switch to the Nathan workspace
    And I open the People settings groups tab as a workspace member
    Then the temporary workspace group is listed with "1 member"
    And workspace members cannot manage or open the temporary workspace group
