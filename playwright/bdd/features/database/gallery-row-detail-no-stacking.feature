Feature: Gallery row detail page no stacking

  Scenario: Escape closes an edited row detail page
    Given the Gallery test app is initialized
    When the Gallery user signs in anonymously
    Then the Gallery user sees the home page with get started page

    When the user creates a Gallery database named "EscapeClose" for row-detail stacking
    And the user clicks the row-detail stacking Gallery card at position 0
    Then exactly one stacking-test row detail page is visible
    And the current stacking-test row detail page has a document

    When the user adds stacking-test row document content "saved before Escape"
    And the user presses Escape to close the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user clicks the row-detail stacking Gallery card at position 0
    Then the current stacking-test row detail page contains text "saved before Escape" 1 time
    When the user closes the stacking-test row detail page

  Scenario: Row detail pages should not stack when dismissed
    Given the Gallery test app is initialized
    When the Gallery user signs in anonymously
    Then the Gallery user sees the home page with get started page

    When the user creates a Gallery database named "StackTest" for row-detail stacking

    When the user clicks the row-detail stacking Gallery card at position 0
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user clicks the row-detail stacking Gallery card at position 1
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user clicks the stacking-test new row button in the database toolbar
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user clicks the stacking-test new row button in the database toolbar
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user creates a document named "NavDoc" and opens the stacking-test Gallery database in a new browser tab
    And the user switches to the Gallery view in the new stacking-test database tab

    When the user clicks the row-detail stacking Gallery card at position 0
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible

    When the user clicks the stacking-test new row button in the database toolbar
    Then exactly one stacking-test row detail page is visible
    When the user closes the stacking-test row detail page
    Then the stacking-test row detail page is not visible
