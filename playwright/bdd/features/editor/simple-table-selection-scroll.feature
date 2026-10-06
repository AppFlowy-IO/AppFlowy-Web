@simple_table_selection_scroll
Feature: Simple table selections follow horizontal scrolling
  Selections stay inside the block while the table is wider than its viewport.
  Hidden selection borders are revealed as the table scrolls.

  Background:
    Given a blank simple table test document is open
    When I open the slash menu
    And I select slash command "simpleTable"
    Then the document has 1 "simple_table" block
    When I make the simple table wider than its block

  Scenario Outline: Overflowing selections are clipped and their far border scrolls into view
    Given the simple table uses the "<theme>" theme
    When I open the simple table "<axis>" selection menu
    Then the simple table "<axis>" selection stays within its horizontal viewport
    When I scroll the simple table with a horizontal wheel gesture
    Then the simple table "<axis>" selection follows the scrolled cells
    And the simple table "<axis>" selection stays within its horizontal viewport
    When I scroll the simple table to the right end with the wheel
    Then the simple table "<axis>" selection follows the scrolled cells
    And the simple table "<axis>" selection stays within its horizontal viewport
    And the simple table "<axis>" selection reveals its right border

    Examples:
      | theme | axis   |
      | light | row    |
      | light | column |
      | light | block  |
      | dark  | row    |
      | dark  | column |
      | dark  | block  |
