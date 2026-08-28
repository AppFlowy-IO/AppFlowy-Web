Feature: Row template relation and rollup

  Scenario: A template relation default applies to created rows and the rollup computes
    Given the RowTemplate test app is initialized
    When the RowTemplate user signs in anonymously
    Then the RowTemplate user sees the home page with get started page

    When the user prepares relation and rollup grids for row templates
    And the user creates a row template named "Task Template" with a relation default to "Alpha"
    Then the template editor shows "1 linked rows"
    And the template editor lists the read-only rollup property

    When the user closes the row template editor dialog
    And the user creates a row from the row template named "Task Template"
    Then the newest grid row links "Alpha" with rollup count "1"
