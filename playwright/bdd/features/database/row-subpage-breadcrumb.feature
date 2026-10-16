@row-subpage-breadcrumb
Feature: Breadcrumbs for subpages inside database rows
  A row page gets its title from the database primary cell, even when its folder view has no title.

  Scenario: A row subpage keeps its ancestry and follows primary-cell title edits
    Given I am signed in with a new account
    And I have created a grid page named "Projects"
    When I set the first grid cell to "Roadmap"
    And I open the grid row named "Roadmap" as a full row page
    And I create a subpage inside the row document
    And I open the new row subpage and name it "Delivery notes"
    Then the subpage breadcrumb ends with "Roadmap" followed by "Delivery notes"
    And the expanded subpage breadcrumb includes "Projects" before "Roadmap" and "Delivery notes"
    When I reload the row subpage
    Then the subpage breadcrumb ends with "Roadmap" followed by "Delivery notes"
    When I change the row primary cell to "Release plan" in another tab
    Then the subpage breadcrumb ends with "Release plan" followed by "Delivery notes"
    When I reload the row subpage
    Then the subpage breadcrumb ends with "Release plan" followed by "Delivery notes"
