@workspace-group-management
Feature: Workspace group management
  Workspace owners can manage workspace groups from People settings.

  Scenario: Owner adds and removes a group member, then deletes the group
    Given I sign in as the Nathan workspace owner
    When I open the People settings groups tab
    And I create a temporary workspace group
    And I open the temporary workspace group
    And I add workspace member "annie@appflowy.io" to the temporary group
    Then the temporary group shows workspace member "annie@appflowy.io"
    When I remove workspace member "annie@appflowy.io" from the temporary group
    Then the temporary group does not show workspace member "annie@appflowy.io"
    When I delete the temporary workspace group
    Then the temporary workspace group is not listed
