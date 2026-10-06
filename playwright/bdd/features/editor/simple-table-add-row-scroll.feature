@simple_table_add_row_scroll
Feature: Adding simple table rows scrolls only when necessary
  The bottom add-row button preserves the page position when the new row fits.
  When it does not fit, the page scrolls only enough to reveal the new row.

  Background:
    Given a blank simple table test document is open
    When I add 40 paragraphs before inserting the simple table
    And I open the slash menu
    And I select slash command "simpleTable"
    Then the document has 1 "simple_table" block
    When I select the first paragraph above the simple table

  Scenario: Adding a row with available space preserves the page position
    When I place the simple table bottom 120 pixels above the page viewport bottom
    And I click the bottom simple table add-row button
    Then the simple table has one more row
    And adding the row has not scrolled the page
    And the new simple table row is fully visible

  Scenario: Adding a row near the viewport bottom reveals only the new row
    When I place the simple table bottom 20 pixels above the page viewport bottom
    And I click the bottom simple table add-row button
    Then the simple table has one more row
    And adding the row has scrolled only enough to reveal it
    And the new simple table row is fully visible

  Scenario: Repeated row additions start scrolling when the available space runs out
    When I leave room for one new simple table row and 20 extra pixels
    And I click the bottom simple table add-row button
    Then the simple table has one more row
    And adding the row has not scrolled the page
    And the new simple table row is fully visible
    When I click the bottom simple table add-row button
    Then the simple table has one more row
    And adding the row has scrolled only enough to reveal it
    And the new simple table row is fully visible

  Scenario Outline: Adding a row to a wide table preserves its horizontal position and column widths
    When I place the simple table bottom 120 pixels above the page viewport bottom
    And I make the simple table wider than its block
    And I scroll the wide simple table horizontally through its cells
    And I select the first paragraph above the simple table
    And I place the simple table bottom <space> pixels above the page viewport bottom
    And I click the bottom simple table add-row button
    Then the simple table has one more row
    And adding the row has <scroll behavior>
    And adding the row has preserved the horizontal position and column widths
    And the new simple table row is fully visible

    Examples:
      | space | scroll behavior                  |
      | 120   | not scrolled the page            |
      | 20    | scrolled only enough to reveal it |

  Scenario Outline: Adding a row and column together follows the same vertical scrolling rules
    When I place the simple table bottom <space> pixels above the page viewport bottom
    And I click the simple table add-row-and-column corner button
    Then the simple table has one more row
    And the simple table has one more column in every row
    And adding the row has <scroll behavior>
    And the new simple table row is fully visible

    Examples:
      | space | scroll behavior                  |
      | 120   | not scrolled the page            |
      | 20    | scrolled only enough to reveal it |
