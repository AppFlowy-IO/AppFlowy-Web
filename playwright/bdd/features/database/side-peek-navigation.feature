Feature: Database side peek navigation

  The previous/next header buttons and their Cmd/Ctrl+Shift+P/N shortcuts
  walk the rows the view shows: filters, sorts and the Gallery search decide
  the order, a row revealed by a wider filter joins it, and a peeked row the
  filter hides stays open with both directions disabled.

  Background:
    Given I am signed in for side peek testing

  Scenario: Previous and next follow the filtered and sorted rows
    Given I have created a grid named "Peek navigation" with rows "Amber, Birch, Cedar"
    And the grid has a text property named "Notes"
    And the row "Amber" has the text "sprint one" in its "Notes" property
    And the row "Birch" has the text "sprint two" in its "Notes" property
    And the row "Cedar" has the text "sprint one" in its "Notes" property
    When I filter the grid where "Notes" contains "sprint one"
    Then the visible rows are "Amber, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek navigation order is "Amber, Cedar"
    And the previous row button is disabled
    And the next row button is enabled
    When I navigate to the next row with the button
    Then the peek shows the title "Cedar"
    And the previous row button is enabled
    And the next row button is disabled
    When I navigate to the previous row with the shortcut
    Then the peek shows the title "Amber"
    # Widening the filter reveals Birch between the rows already walked.
    When I filter the grid where "Notes" contains "sprint"
    Then the visible rows are "Amber, Birch, Cedar"
    And the peek navigation order is "Amber, Birch, Cedar"
    When I navigate to the next row with the button
    Then the peek shows the title "Birch"
    When I sort the grid by "Name" descending
    Then the visible rows are "Cedar, Birch, Amber"
    And the peek navigation order is "Cedar, Birch, Amber"
    When I navigate to the next row with the shortcut
    Then the peek shows the title "Amber"
    And the next row button is disabled
    When I navigate to the previous row with the button
    Then the peek shows the title "Birch"
    When I navigate to the previous row with the shortcut
    Then the peek shows the title "Cedar"
    And the previous row button is disabled
    # At the first row the previous shortcut is a no-op.
    When I navigate to the previous row with the shortcut
    Then the peek shows the title "Cedar"

  Scenario: A peeked row hidden by the filter stays open with both directions disabled
    Given I have created a grid named "Peek filtered out" with rows "Amber, Birch, Cedar"
    And the grid has a text property named "Notes"
    And the row "Amber" has the text "sprint one" in its "Notes" property
    And the row "Birch" has the text "sprint two" in its "Notes" property
    And the row "Cedar" has the text "sprint one" in its "Notes" property
    When I open the row "Cedar" in the peek from the grid
    Then the peek is open in side mode showing "Cedar"
    And the previous row button is enabled
    And the next row button is disabled
    When I filter the grid where "Notes" contains "sprint two"
    Then the visible rows are "Birch"
    And the peek shows the title "Cedar"
    And the previous row button is disabled
    And the next row button is disabled
    When I navigate to the next row with the shortcut
    And I navigate to the previous row with the shortcut
    Then the peek shows the title "Cedar"
    When I close the peek with the close button
    And I open the row "Birch" in the peek from the grid
    Then the peek is open in side mode showing "Birch"
    And the previous row button is disabled
    And the next row button is disabled
    # The persisted filter still bounds the order on a fresh load.
    When I close the peek with the close button
    And I reload the database page
    Then the visible rows are "Birch"
    When I open the row "Birch" in the peek from the grid
    Then the peek is open in side mode showing "Birch"
    And the previous row button is disabled
    And the next row button is disabled

  Scenario: A Gallery search narrows the navigation order and outlives the peek
    Given I have created a grid named "Peek search" with rows "Amber task, Birch note, Cedar task"
    And I add a "Gallery" view from the database tab bar
    When I search the database view for "task"
    Then the visible rows are "Amber task, Cedar task"
    When I open the row "Amber task" in the peek from the gallery view
    Then the peek is open in side mode showing "Amber task"
    And the database view search shows "task"
    And the peek navigation order is "Amber task, Cedar task"
    And the previous row button is disabled
    And the next row button is enabled
    When I navigate to the next row with the shortcut
    Then the peek shows the title "Cedar task"
    And the next row button is disabled
    When I close the peek with Escape
    Then no peek is open
    And the database view search shows "task"
    And the visible rows are "Amber task, Cedar task"
    When I open the row "Cedar task" in the peek from the gallery view
    Then the peek is open in side mode showing "Cedar task"
    And the previous row button is enabled
    And the next row button is disabled
    When I close the peek with the close button
    Then no peek is open
    And the database view search shows "task"
    And the visible rows are "Amber task, Cedar task"
