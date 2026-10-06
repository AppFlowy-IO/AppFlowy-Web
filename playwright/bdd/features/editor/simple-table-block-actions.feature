@simple_table_block_actions
Feature: Simple table block actions
  A table's six-dot handle opens the shared block menu and selects the whole table.
  Layout actions and conversions preserve its cell content.

  Background:
    Given a blank simple table test document is open
    When I open the slash menu
    And I select slash command "simpleTable"
    Then the document has 1 "simple_table" block
    When I enter "Name" in simple table cell 0, 0
    And I enter "Status" in simple table cell 0, 1
    And I enter "Alice" in simple table cell 1, 0
    And I enter "Ready" in simple table cell 1, 1

  Scenario Outline: The block handle shows table actions and selection clears when dismissed
    Given the simple table uses the "<theme>" theme
    When I open the simple table block menu
    Then the simple table block menu offers all design actions
    And the whole simple table has the design selection effect
    When I dismiss the simple table block menu
    Then the whole simple table is no longer selected

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: Block layout actions resize and align every column
    When I resize the first simple table column by 80 pixels
    And I open the simple table block menu
    And I choose simple table block action "Distribute columns evenly"
    Then simple table columns have equal widths without changing the total width
    When I open the simple table block menu
    And I choose simple table block action "Set to page width"
    Then the simple table fits the document width
    When I open the simple table block menu
    And I choose simple table block action "Align"
    And I choose simple table alignment "Center"
    Then every simple table column has center alignment
    And the simple table still contains its original cell content

  Scenario: Block links, duplication, and deletion target the whole table
    When I open the simple table block menu
    And I choose simple table block action "Copy link to block"
    Then the clipboard contains a link to the simple table block
    When I open the simple table block menu
    And I choose simple table block action "Duplicate"
    Then the document has 2 "simple_table" block
    And both simple tables contain the original cell content
    When I open the simple table block menu
    And I choose simple table block action "Delete"
    Then the document has 1 "simple_table" block
    And the simple table still contains its original cell content

  Scenario: Text conversion preserves cells and supports keyboard undo and redo
    When I open the simple table block menu
    And I choose simple table block action "Convert to text"
    Then the document has 0 "simple_table" block
    And the editor contains "Name"
    And the editor contains "Status"
    And the editor contains "Alice"
    And the editor contains "Ready"
    When I undo the editor change
    Then the original simple table is restored with its content and layout
    When I redo the simple table conversion with the keyboard
    Then the document has 0 "simple_table" block
    And the editor contains "Name"
    And the editor contains "Status"
    And the editor contains "Alice"
    And the editor contains "Ready"

  Scenario: Deleting the only table leaves an editable document
    When I open the simple table block menu
    And I choose simple table block action "Delete"
    Then the document has 0 "simple_table" block
    When I type "A new paragraph" in the editor
    Then the editor contains "A new paragraph"

  Scenario: Database conversion preserves cells and supports keyboard undo and redo
    When I open the simple table block menu
    And I choose simple table block action "Turn into database"
    Then the simple table is replaced by a database containing its original cells
    When I undo the editor change
    Then the document has 0 "grid" block
    And the original simple table is restored with its content and layout
    When I redo the simple table conversion with the keyboard after waiting 3 seconds
    Then the simple table is replaced by a database containing its original cells
