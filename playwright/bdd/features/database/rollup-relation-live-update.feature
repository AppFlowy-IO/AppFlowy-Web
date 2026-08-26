@rollup-reactivity
Feature: Rollup values update when their relation changes
  A relation edit already persists the correct row IDs, so refreshing the page
  must not be required to make a mounted Count all rollup show the new total.

  Scenario: Count all updates immediately in a sorted grid
    Given the rollup reactivity user is signed in
    And a rollup target grid with rows "Alpha, Bravo, Charlie, Delta, Echo, Foxtrot"
    And a rollup source grid with one row "Project One"
    And a relation property "Employees" and count-all rollup "Employee Count" are configured
    And the source row initially links one target
    And the rollup source grid is sorted by "Name"
    When the source relation is expanded to all six targets without refreshing
    Then the source relation contains six targets
    And the mounted rollup shows "6" without refreshing
