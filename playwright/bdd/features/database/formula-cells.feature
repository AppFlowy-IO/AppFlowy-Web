@formula @formula-cells
Feature: Formula cells
  Formula cells show their result like a native cell of the result type,
  update whenever an input changes, surface errors, and appear on the row
  page and in Board, Gallery and List views.

  Background:
    Given a Grid for formula testing with these properties
      | property | type     | row 1      | row 2   |
      | Name     | Text     | One        | Two     |
      | Price    | Number   | 12.5       | 40      |
      | Done     | Checkbox | yes        | no      |
      | Due      | Date     | 2024-03-10 | <empty> |
      | Tags     | MultiSelect | a, b    | c       |

  Scenario: Results render like native cells of their type
    When I add these formula properties
      | name   | expression                          |
      | text   | prop("Name") + "!"                  |
      | number | prop("Price") * 2                   |
      | check  | prop("Done")                        |
      | date   | dateAdd(prop("Due"), 1, "days")     |
      | list   | prop("Tags")                        |
    Then the formula properties show these values for row 1
      | name   | value      |
      | text   | One!       |
      | number | 25         |
      | check  | Yes        |
      | date   | 03/11/2024 |
      | list   | a, b       |
    And row 1 of "number" is aligned right
    And row 1 of "text" is aligned left
    And row 1 of "check" shows a checked checkbox
    And row 2 of "check" shows an unchecked checkbox
    And row 2 of "date" is empty

  Scenario: Checkbox results are read-only
    Given a formula property "Passed" with the expression "prop("Price") > 20"
    When I click row 1 of "Passed"
    Then the formula editor is open with a formula
    When I close the formula editor with "the Cancel button"
    Then row 1 of "Passed" shows an unchecked checkbox
    And row 2 of "Passed" shows a checked checkbox

  Scenario: A broken formula shows an error and explains it on hover
    Given a formula property "Broken" with the expression "prop("Price") * 2"
    When I delete the property "Price" from its header menu
    Then row 1 of "Broken" shows an error
    And row 2 of "Broken" shows an error
    When I hover the error in row 2 of "Broken"
    Then the error tooltip reads "Unknown property"

  Scenario: Formulas re-evaluate when their inputs change
    Given a formula property "Summary" with the expression "prop("Name") + ": " + format(prop("Price") * 2) + " " + prop("Tags").join("/")"
    Then the formula "Summary" shows these values
      | One: 25 a/b |
      | Two: 80 c   |
    When I type "15" into row 1 of "Price"
    Then the formula "Summary" shows these values
      | One: 30 a/b |
      | Two: 80 c   |
    When a collaborator sets row 2 of "Name" to "Second"
    Then the formula "Summary" shows these values
      | One: 30 a/b    |
      | Second: 80 c   |
    When a collaborator renames the option "c" of "Tags" to "gamma"
    Then the formula "Summary" shows these values
      | One: 30 a/b      |
      | Second: 80 gamma |
    When I open the formula editor of "Summary" from the property menu
    And I type the formula "upper(prop("Name"))"
    And I close the formula editor with "the Done button"
    Then the formula "Summary" shows these values
      | ONE    |
      | SECOND |

  Scenario: New rows compute immediately
    Given a formula property "Label" with the expression "if(empty(prop("Name")), "untitled", prop("Name"))"
    When I add a row to the grid
    Then the formula "Label" shows these values
      | One      |
      | Two      |
      | untitled |

  Scenario: Formulas persist across a reload
    Given a formula property "Shout" with the expression "upper(prop("Name")) + "!""
    When I reload the grid
    Then the formula "Shout" shows these values
      | ONE! |
      | TWO! |

  Scenario: The row page shows formula values and a placeholder for an empty formula
    Given a formula property "Label" with the expression "prop("Name") + "!""
    And a formula property "Blank" with the expression ""
    When I open the row page of row 1
    Then the row page shows the formula "Label" as "One!"
    And the row page shows the formula "Blank" as "Edit formula"

  Scenario: Board, Gallery and List views show formula values
    Given a formula property "Label" with the expression "prop("Name") + " #" + format(prop("Price"))"
    When I add a "Board" view
    And I show the property "Label" in the current view
    Then the current view shows the formula "Label" for row 1 as "One #12.5"
    When I add a "Gallery" view
    And I show the property "Label" in the current view
    Then the current view shows the formula "Label" for row 1 as "One #12.5"
    When I add a "List" view
    And I show the property "Label" in the current view
    Then the current view shows the formula "Label" for row 1 as "One #12.5"

  Scenario: Wrap cell content applies to formula text
    Given a formula property "Long" with the expression "repeat("formula ", 12)"
    Then row 1 of "Long" does not wrap
    When I turn on wrapping for "Long"
    Then row 1 of "Long" wraps
