@workspace-group-management
Feature: Workspace group management
  Workspace owners can manage workspace groups from People settings.

  Background:
    Given the seeded spm0622 space permission fixture exists

  Scenario: Owner adds and removes a group member, then deletes a temporary group
    Given I sign in as seeded spm0622 "owner 1"
    When I open the People settings groups tab
    And I create a temporary workspace group
    And I open the temporary workspace group
    And I add workspace member "spm0622-member-closed@appflowy.local" to the temporary group
    Then the temporary group shows workspace member "spm0622-member-closed@appflowy.local"
    When I remove workspace member "spm0622-member-closed@appflowy.local" from the temporary group
    Then the temporary group does not show workspace member "spm0622-member-closed@appflowy.local"
    When I delete the temporary workspace group
    Then the temporary workspace group is not listed

  Scenario: Owner can inspect and update the seeded workspace group
    Given I sign in as seeded spm0622 "owner 1"
    When I open the People settings groups tab
    Then the workspace groups list shows "spm0622 Full Access Space Group" with "2 members"
    When I open workspace group "spm0622 Full Access Space Group"
    Then the group detail panel shows workspace member "spm0622-member-default@appflowy.local"
    And the group detail panel shows workspace member "spm0622-member-open@appflowy.local"
    And the group detail panel does not show workspace member "spm0622-member-closed@appflowy.local"
    And the group detail member search for "spm0622-member-closed@appflowy.local" shows an addable workspace member
    When I add workspace member "spm0622-member-closed@appflowy.local" to the open group
    Then the group detail panel shows workspace member "spm0622-member-closed@appflowy.local"
    When I remove workspace member "spm0622-member-closed@appflowy.local" from the open group
    Then the group detail panel does not show workspace member "spm0622-member-closed@appflowy.local"
