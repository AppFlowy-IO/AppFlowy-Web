@simple_table_headers
Feature: Simple table header menus
  The first row and column can be styled as headers from their own menus.
  Header choices stay independent and are restored when the document is reopened.

  Background:
    Given a blank simple table test document is open
    When I open the slash menu
    And I select slash command "simpleTable"
    Then the document has 1 "simple_table" block

  Scenario Outline: Header switches support pointer and keyboard input and survive reloads
    Given the simple table uses the "<theme>" theme
    When I open the simple table "<axis>" menu for index 0
    Then the simple table "<axis>" menu selection has the design blue border
    And the simple table "<axis>" header switch is "disabled"
    And the simple table "<axis>" header is "disabled"
    When I enable the simple table "<axis>" header switch
    Then the simple table "<axis>" header switch is "enabled"
    And the simple table "<axis>" header is "enabled"
    And the simple table "<axis>" header cells use the theme header fill
    And simple table cell 1, 1 has the default background
    When I close the simple table menu
    And I open the simple table "<axis>" menu for index 0
    Then the simple table "<axis>" header switch is "enabled"
    When I click the simple table "<axis>" header label
    Then the simple table "<axis>" header switch is "disabled"
    And the simple table "<axis>" header is "disabled"
    And the simple table cells have no header styling
    When I toggle the simple table "<axis>" header with Space
    Then the simple table "<axis>" header switch is "enabled"
    And the simple table "<axis>" header is "enabled"
    When I close the simple table menu
    And I reload the document containing the simple table
    And I open the simple table "<axis>" menu for index 0
    Then the simple table "<axis>" header switch is "enabled"
    And the simple table "<axis>" header cells use the theme header fill
    When I toggle the simple table "<axis>" header with Space
    Then the simple table "<axis>" header switch is "disabled"
    And the simple table "<axis>" header is "disabled"
    And the simple table cells have no header styling
    When I close the simple table menu
    And I reload the document containing the simple table
    And I open the simple table "<axis>" menu for index 0
    Then the simple table "<axis>" header switch is "disabled"
    And the simple table "<axis>" header is "disabled"

    Examples:
      | theme | axis   |
      | light | row    |
      | light | column |
      | dark  | row    |
      | dark  | column |

  Scenario Outline: Later row and column menus do not expose a header switch
    When I open the simple table "<axis>" menu for index 0
    And I enable the simple table "<axis>" header switch
    And I close the simple table menu
    And I open the simple table "<axis>" menu for index 1
    Then the simple table "<axis>" menu selection has the design blue border
    And the simple table menu has no header switch
    And the simple table menu still offers Color and Align
    And the simple table "<axis>" header is "enabled"
    When I close the simple table menu
    And I open the simple table "<axis>" menu for index 0
    Then the simple table "<axis>" header switch is "enabled"

    Examples:
      | axis   |
      | row    |
      | column |

  Scenario Outline: Row and column headers remain independent and share one intersection fill
    Given the simple table uses the "<theme>" theme
    When I open the simple table "row" menu for index 0
    And I enable the simple table "row" header switch
    And I close the simple table menu
    And I open the simple table "column" menu for index 0
    And I enable the simple table "column" header switch
    Then the simple table "row" header is "enabled"
    And the simple table "column" header is "enabled"
    And the simple table "row" header cells use the theme header fill
    And the simple table "column" header cells use the theme header fill
    And simple table cell 1, 1 has the default background
    When I close the simple table menu
    And I open the simple table "row" menu for index 0
    And I click the simple table "row" header label
    Then the simple table "row" header is "disabled"
    And the simple table "column" header is "enabled"
    And the simple table "column" header cells use the theme header fill
    And simple table cell 0, 1 has the default background
    When I close the simple table menu
    And I open the simple table "column" menu for index 0
    Then the simple table "column" header switch is "enabled"
    When I click the simple table "column" header label
    Then the simple table "column" header is "disabled"
    And the simple table cells have no header styling

    Examples:
      | theme |
      | light |
      | dark  |
