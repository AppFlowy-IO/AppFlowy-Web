@workspace-switch-race
Feature: Workspace switching keeps sidebar spaces scoped to the active workspace
  A response started for the previous workspace must not replace the sidebar
  after the user has switched to another workspace.

  Scenario: A delayed previous-workspace outline never renders under the target workspace
    Given I am signed in with isolated source and target workspaces
    And the next source workspace outline response is delayed
    When I reload the source workspace while its outline response is delayed
    And I switch to the target workspace
    Then the target workspace outline is visible
    When the delayed source workspace outline response completes
    Then the target workspace never renders the source workspace space
