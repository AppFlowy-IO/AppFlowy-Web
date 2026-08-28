Feature: Published toggle list interactions
  Regression coverage for "support toggle on publish". A toggle list must stay
  interactive in the read-only published view: clicking its toggle icon collapses
  and expands the inner content even though the published document is rendered with
  a static (non-Yjs) editor that has no shared root.

  Background:
    Given a blank document page is open

  Scenario: Toggle list collapses and expands in the published view
    When I type "> Parent Toggle" in the editor
    And I press "Enter"
    And I type "Hidden Child" in the editor
    Then the editor visibly contains "Hidden Child"
    When I publish the current page
    And I open the published page
    Then the editor visibly contains "Parent Toggle"
    And the editor visibly contains "Hidden Child"
    When I toggle the toggle list icon
    Then the editor does not visibly contain "Hidden Child"
    When I toggle the toggle list icon
    Then the editor visibly contains "Hidden Child"
