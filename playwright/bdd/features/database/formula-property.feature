@formula @formula-property
Feature: Formula property settings
  A formula is a property like any other: it can be renamed, duplicated,
  hidden, deleted and converted to and from other types. Number results get
  a Number format and Show as settings; formulas can build on other formulas
  but never on themselves.

  Background:
    Given a Grid for formula testing with these properties
      | property | type   | row 1 | row 2 |
      | Name     | Text   | One   | Two   |
      | Price    | Number | 1200  | 35    |
      | Qty      | Number | 2     | 5     |

  Scenario: The type list describes Formula
    When I hover the Formula type in the new property menu
    Then the type tooltip reads "Compute a value from other properties with a formula"

  Scenario: The Number format can be searched and chosen for number results
    Given a formula property "Total" with the expression "prop("Price") * 1.1"
    Then the number format of "Total" is "Number"
    When I search the number formats of "Total" for "dol"
    Then the number format choices are
      | US dollar            |
      | Canadian dollar      |
      | Hong Kong dollar     |
      | New Zealand dollar   |
    When I set the number format of "Total" to "US dollar"
    Then the number format of "Total" is "US dollar"
    And the formula "Total" shows these values
      | $1,320 |
      | $38.5  |
    When I open the formula editor of "Total" by clicking its cell in row 2
    Then the formula preview shows "$38.5"
    When I close the formula editor with "the Cancel button"
    # Like Notion, Percent shows the result multiplied by 100.
    When I set the number format of "Total" to "Percent"
    Then the formula "Total" shows these values
      | 132,000% |
      | 3,850%   |

  Scenario: Text, checkbox and date results offer no Number format or Show as
    Given a formula property "Label" with the expression "prop("Name") + "!""
    And a formula property "Big" with the expression "prop("Price") > 100"
    And a formula property "When" with the expression "now()"
    Then the property menu of "Label" offers no Number format or Show as
    And the property menu of "Big" offers no Number format or Show as
    And the property menu of "When" offers no Number format or Show as
    When I open the formula editor of "Label" from the property menu
    And I type the formula "prop("Price") * 2"
    And I close the formula editor with "the Done button"
    Then the property menu of "Label" offers a Number format and Show as

  Scenario: Show as Bar and Ring with color, divide by and show number
    Given a formula property "Score" with the expression "prop("Qty") * 10"
    When I show "Score" as "Bar"
    Then row 1 of "Score" shows a bar filled 20%
    And row 2 of "Score" shows a bar filled 50%
    When I set the Show as divisor of "Score" to "50"
    Then row 1 of "Score" shows a bar filled 40%
    And row 2 of "Score" shows a bar filled 100%
    When I set the Show as color of "Score" to "text-color-1"
    Then row 1 of "Score" shows a bar colored "text-color-1"
    When I toggle Show number for "Score"
    Then row 1 of "Score" shows a bar with the number "20"
    When I show "Score" as "Ring"
    Then row 1 of "Score" shows a ring
    When I show "Score" as "Number"
    Then the formula "Score" shows these values
      | 20 |
      | 50 |

  Scenario: Renaming a referenced property keeps the formula working
    Given a formula property "Total" with the expression "prop("Price") * prop("Qty")"
    When I rename the property "Price" to "Unit cost"
    Then the formula "Total" shows these values
      | 2400 |
      | 175  |
    When I open the formula editor of "Total" from the property menu
    Then the formula editor contains "prop("Unit cost") * prop("Qty")"
    And the property menu of "Total" shows the formula item "prop("Unit cost") * prop("Qty")"

  Scenario Outline: Converting a formula to <type> keeps what it displayed
    Given a formula property "Result" with the expression "<expression>"
    When I switch the property "Result" to "<type>"
    Then the "Result" cells read in order
      | <row 1> |
      | <row 2> |

    Examples:
      | type     | expression                        | row 1   | row 2   |
      | Text     | prop("Name") + " x" + format(prop("Qty")) | One x2  | Two x5  |
      | Number   | prop("Price") / 100               | 12      | 0.35    |
      | Checkbox | prop("Qty") > 3                   | No      | Yes     |

  Scenario: Converting a formula to a date keeps the dates
    Given a formula property "Result" with the expression "parseDate("2024-03-10")"
    When I switch the property "Result" to "Date"
    Then the "Result" cells read in order
      | 03/10/2024 |
      | 03/10/2024 |

  Scenario: Switching back to Formula restores the expression
    Given a formula property "Total" with the expression "prop("Price") * prop("Qty")"
    When I switch the property "Total" to "Text"
    Then the "Total" cells read in order
      | 2400 |
      | 175  |
    When I switch the property "Total" to "Formula"
    Then the formula editor contains "prop("Price") * prop("Qty")"
    When I close the formula editor with "the Done button"
    Then the formula "Total" shows these values
      | 2400 |
      | 175  |

  Scenario: Duplicating a formula property copies its formula
    Given a formula property "Total" with the expression "prop("Price") * prop("Qty")"
    When I duplicate the property "Total" from its header menu as "Copy"
    Then the formula "Copy" shows these values
      | 2400 |
      | 175  |
    When I open the formula editor of "Copy" from the property menu
    Then the formula editor contains "prop("Price") * prop("Qty")"

  Scenario: Deleting a referenced property turns dependent formulas into errors
    Given a formula property "Total" with the expression "prop("Price") * prop("Qty")"
    When I delete the property "Qty" from its header menu
    Then row 1 of "Total" shows an error
    When I hover the error in row 1 of "Total"
    Then the error tooltip reads "Unknown property"

  Scenario: The header menu of a formula column
    Given a formula property "Total" with the expression "prop("Price") * prop("Qty")"
    Then the header menu of "Total" offers these actions
      | edit-property |
      | insert-left   |
      | insert-right  |
      | hide          |
      | filter        |
      | duplicate     |
      | delete        |
      | wrap          |
    And the header menu of "Price" offers the action "clear"
    When I hide the property "Total" from its header menu
    Then the property "Total" is not shown in the grid

  Scenario: Formulas can reference other formulas but never themselves
    Given a formula property "Tax" with the expression "prop("Price") * 0.2"
    And a formula property "Total" with the expression "prop("Price") + prop("Tax")"
    Then the formula "Total" shows these values
      | 1440 |
      | 42   |
    When I open the formula editor of "Tax" from the property menu
    And I type the formula "prop("Price") * 0.5"
    And I close the formula editor with "the Done button"
    Then the formula "Total" shows these values
      | 1800 |
      | 52.5 |
    When I open the formula editor of "Total" from the property menu
    And I type the formula "prop("Total") + 1"
    Then the formula editor shows the error "Property "Total" would reference itself"
    And the Done button is disabled
    When I type the formula "prop("Tax") + 1"
    Then the formula editor shows no error
    When I close the formula editor with "the Cancel button"
    And I open the formula editor of "Tax" from the property menu
    And I type the formula "prop("Total") * 0.2"
    Then the formula editor shows the error "would reference itself"
