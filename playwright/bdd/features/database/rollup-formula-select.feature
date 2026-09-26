@rollup-formula-select
Feature: Rollups aggregate formula results and selected options
  A related row matching two selected options counts once. Blank related cells
  remain in the percentage denominator. Formula targets use their result type.

  Scenario: Configure formula and select rollups, observe edits, and reload
    Given disposable related grids contain formula and select rollup inputs
    When the rollup targets "Double" using "Sum"
    Then the configured rollup shows "120"
    When the rollup targets "Complete" using "Percent checked"
    Then the configured rollup shows "50.0%"
    When the rollup targets "Stage" using "Count values"
    And the rollup matches the options "Red, Blue"
    Then the configured rollup shows "2"
    When the rollup targets "Stage" using "Percent values"
    Then the configured rollup shows "50.0%"
    When the rollup page is reloaded
    Then the configured rollup shows "50.0%"
    And the rollup retains the matching options "Red, Blue"
    When the rollup targets "Tags" using "Count values"
    And the rollup matches the options "Red, Blue"
    Then the configured rollup shows "2"
    When the rollup targets "Tags" using "Percent values"
    Then the configured rollup shows "50.0%"
    When another tab adds "Blue" to "Tags" in related row 3
    Then the configured rollup shows "75.0%" without refreshing
    When the rollup targets "Stage" using "Percent values"
    And the rollup matches the options "Red, Blue"
    And another tab selects "Red" for "Stage" in related row 3
    Then the configured rollup shows "75.0%" without refreshing
    When the rollup targets "Double" using "Sum"
    And another tab changes the related amount in row 3 to "40"
    Then the configured rollup shows "140" without refreshing
    When the rollup targets "Complete" using "Percent checked"
    And another tab toggles the related checkbox in row 2
    Then the configured rollup shows "75.0%" without refreshing
    When the rollup page is reloaded
    Then the configured rollup shows "75.0%"
