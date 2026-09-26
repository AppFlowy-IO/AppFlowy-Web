@rollup-formula-select @rollup-formula-workflows
Feature: Real project workflows with formulas and rollups
  Related task formulas calculate conditional amounts and flags. Project rollups
  aggregate those results and can themselves feed a project formula. Unrelated
  tasks never contribute, and blank statuses remain in percentage denominators.

  Scenario: Project effort follows source edits, formula edits, relations, and reload
    Given disposable related grids contain the "project effort" formula workflow
    When the rollup targets "Completed hours" using "Sum"
    Then the configured rollup shows "8"
    When the project adds a formula that summarizes completed hours
    Then the project summary formula shows "8 hours done"
    When another tab changes "Hours" in related row 1 to "12"
    Then the configured rollup shows "12" without refreshing
    And the project summary formula shows "12 hours done"
    When another tab selects "Done" for "Stage" in related row 2
    Then the configured rollup shows "28" without refreshing
    And the project summary formula shows "28 hours done"
    When the rollup targets "Complete" using "Percent checked"
    Then the configured rollup shows "100.0%"
    When the rollup targets "Completed hours" using "Sum"
    And another tab changes the "Completed hours" formula to "if(prop(\"Stage\") == \"Done\", prop(\"Hours\") * 2, 0)"
    Then the configured rollup shows "56" without refreshing
    And the project summary formula shows "56 hours done"
    When the project unlinks the related row "Write brief"
    Then the configured rollup shows "32" without refreshing
    And the project summary formula shows "32 hours done"
    When the project links the related row "Write brief"
    Then the configured rollup shows "56" without refreshing
    And the project summary formula shows "56 hours done"
    When another tab changes "Hours" in related row 1 to "0"
    Then the configured rollup shows "32" without refreshing
    And the project summary formula shows "32 hours done"
    When the project links the related row "Unspecified"
    And the rollup targets "Complete" using "Percent checked"
    Then the configured rollup shows "66.7%"
    When the rollup page is reloaded
    Then the configured rollup shows "66.7%"
    And the rollup retains target "Complete" and calculation "Percent checked"
    And the related formula "Completed hours" retains the expression "if(prop(\"Stage\") == \"Done\", prop(\"Hours\") * 2, 0)" after reload

  Scenario: Research task counts and completed hours handle blanks, no matches, and empty relations
    Given disposable related grids contain the "research tasks" formula workflow
    When the rollup targets "Completed task" using "Sum"
    Then the configured rollup shows "2"
    When the rollup targets "High priority unfinished" using "Sum"
    Then the configured rollup shows "1"
    When the rollup targets "Completed hours" using "Sum"
    Then the configured rollup shows "28"
    When the rollup targets "Complete" using "Percent checked"
    Then the configured rollup shows "66.7%"
    When the project links the related row "Unspecified"
    Then the configured rollup shows "50.0%" without refreshing
    When the project unlinks the related row "Design homepage"
    And the project unlinks the related row "Build frontend"
    And the project unlinks the related row "Unspecified"
    And the rollup targets "Completed hours" using "Sum"
    Then the configured rollup shows "0"
    When the project links the related row "Unspecified"
    And the project unlinks the related row "QA testing"
    Then the configured rollup shows "0" without refreshing
    When the project unlinks the related row "Unspecified"
    Then the configured rollup shows "" without refreshing
    When the project links the related row "Design homepage"
    And the project links the related row "Build frontend"
    And the project links the related row "QA testing"
    Then the configured rollup shows "28" without refreshing
    When the rollup page is reloaded
    Then the configured rollup shows "28"
    And the rollup retains target "Completed hours" and calculation "Sum"

  Scenario: Expense line formulas roll up into a project budget
    Given disposable related grids contain the "expenses" formula workflow
    When the rollup targets "Expense amount" using "Sum"
    Then the configured rollup shows "2100"
    When the project adds a formula for the remaining budget
    Then the project summary formula shows "900"
    When another tab changes "Quantity" in related row 3 to "2"
    Then the configured rollup shows "2400" without refreshing
    And the project summary formula shows "600"
    When the rollup page is reloaded
    Then the configured rollup shows "2400"
    And the project summary formula shows "600"
    And the rollup retains target "Expense amount" and calculation "Sum"
