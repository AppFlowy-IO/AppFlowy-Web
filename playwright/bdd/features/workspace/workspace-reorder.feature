@workspace-reorder
Feature: Workspace list drag-and-drop reordering
  Users can drag workspaces in the dropdown to set a personal display order.
  The new order is persisted server-side via PUT /api/workspace/reorder and
  survives closing and reopening the dropdown.

  Scenario: Reordering a workspace persists after reopening the list
    Given I am signed in with three new workspaces named "Alpha WS", "Bravo WS", "Charlie WS"
    When I open the workspace dropdown
    Then the tracked workspaces appear in order "Alpha WS, Bravo WS, Charlie WS"
    When I drag workspace "Charlie WS" above workspace "Alpha WS"
    Then the tracked workspaces appear in order "Charlie WS, Alpha WS, Bravo WS"
    When I close the workspace dropdown
    And I open the workspace dropdown
    Then the tracked workspaces appear in order "Charlie WS, Alpha WS, Bravo WS"

  Scenario: Reordering through an overflowing dropdown auto-scrolls the workspace list
    Given I am signed in with 12 new workspaces named "Overflow WS"
    When I open the workspace dropdown
    Then the workspace dropdown list is scrollable
    When I drag workspace "Overflow WS 01" to the bottom edge of the workspace list until it reaches the end
    Then the workspace dropdown list scrolled during the drag
    And the tracked workspaces appear in order "Overflow WS 02, Overflow WS 03, Overflow WS 04, Overflow WS 05, Overflow WS 06, Overflow WS 07, Overflow WS 08, Overflow WS 09, Overflow WS 10, Overflow WS 11, Overflow WS 12, Overflow WS 01"

  Scenario: Rapid consecutive reorders save serially and keep the latest order
    Given I am signed in with three new workspaces named "Rapid Alpha WS", "Rapid Bravo WS", "Rapid Charlie WS"
    And workspace reorder saves are delayed
    When I open the workspace dropdown
    And I drag workspace "Rapid Charlie WS" above workspace "Rapid Alpha WS"
    And the first workspace reorder save has started
    And I drag workspace "Rapid Bravo WS" above workspace "Rapid Charlie WS"
    Then only one workspace reorder save has started while the first save is pending
    When the delayed workspace reorder save completes
    Then the latest workspace reorder save contains tracked workspaces in order "Rapid Bravo WS, Rapid Charlie WS, Rapid Alpha WS"
    And the tracked workspaces appear in order "Rapid Bravo WS, Rapid Charlie WS, Rapid Alpha WS"
    When I close the workspace dropdown
    And I open the workspace dropdown
    Then the tracked workspaces appear in order "Rapid Bravo WS, Rapid Charlie WS, Rapid Alpha WS"
