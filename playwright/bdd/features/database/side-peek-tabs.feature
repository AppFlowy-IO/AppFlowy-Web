Feature: Database side peek across browser tabs

  Mirrors the desktop "Two tabs retain independent peek editing sessions"
  scenario. Two tabs of one browser session open the same grid: each tab's peek
  keeps its own document editor and undo history while the other tab edits, an
  undo only reverts the tab's own change, and a rename made in one tab reaches
  the other tab's open peek while it stays open.

  Scenario: Two browser tabs keep independent peek editing sessions and undo histories
    Given I am signed in for side peek testing
    And I have created a grid named "Independent peeks" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    And I append "First baseline" to the peek document
    And I mark the peek document editor
    And I remember the peek document editing history
    And I open a second browser tab on the same page
    And I open the row "Birch" in the peek from the grid
    And I append "Second baseline" to the peek document
    And I mark the peek document editor
    And I remember the peek document editing history
    When I switch to browser tab 1
    Then the peek in this tab is still open showing "Amber"
    And the peek document editor was not recreated
    And the peek document editing history is retained
    When I select all text in the peek document
    Then only the peek document has the selected text "First baseline"
    When I append " undo first" to the peek document
    And I undo the last change in the peek document
    Then the peek document contains "First baseline"
    And the peek document does not contain "undo first"
    And the peek document does not contain "Second baseline"
    When I switch to browser tab 2
    Then the peek in this tab is still open showing "Birch"
    And the peek document editor was not recreated
    And the peek document editing history is retained
    When I select all text in the peek document
    Then only the peek document has the selected text "Second baseline"
    When I append " undo second" to the peek document
    And I undo the last change in the peek document
    Then the peek document contains "Second baseline"
    And the peek document does not contain "undo second"
    And the peek document does not contain "First baseline"
    When I close the peek with the close button
    And I open the row "Amber" in the peek from the grid
    And I set the peek title to "Still live"
    And I switch to browser tab 1
    Then the peek in this tab is still open showing "Still live"
    And the peek document editor was not recreated
    And the peek document contains "First baseline"
    When I reload the database page
    Then the visible rows are "Still live, Birch, Cedar"
    When I open the row "Still live" in the peek from the grid
    Then the peek document contains "First baseline"
    And the peek document does not contain "undo first"
    When I open the row "Birch" in the peek from the grid
    Then the peek document contains "Second baseline"
    And the peek document does not contain "undo second"
