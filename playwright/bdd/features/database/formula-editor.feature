@formula @formula-editor
Feature: Formula editor
  The formula editor is where a formula is written: it opens from the type
  list, the property menu, a cell or the row page; it highlights the formula,
  suggests functions and properties, documents everything it offers, infers
  the result type, explains errors with their position and previews the
  result for a chosen row. Nothing is saved until the formula is committed.

  Background:
    Given a Grid for formula testing with these properties
      | property | type   | row 1 | row 2 | row 3   |
      | Name     | Text   | One   | Two   | <empty> |
      | Price    | Number | 12.5  | 4     | 0       |
      | Notes    | Text   | alpha | beta  | <empty> |

  # ---------------------------------------------------------------------------
  # Opening the editor
  # ---------------------------------------------------------------------------

  Scenario: Picking Formula from the new property type list opens the editor on an empty formula
    When I start a new formula property
    Then the formula editor is open with an empty formula
    And the formula editor title shows "Formula"
    And the formula editor infers type "empty"
    When I type the formula "prop("Price") * 2"
    Then the formula editor infers type "number"
    And the formula preview shows "25"
    And the formula editor shows no error
    When I close the formula editor with "the Done button"
    Then the formula "Formula" shows these values
      | 25 |
      | 8  |
      | 0  |

  Scenario: Switching an existing property to Formula opens the editor, picking Formula again does not
    When I switch the property "Notes" to "Formula"
    Then the formula editor is open with an empty formula
    And the formula editor title shows "Notes"
    When I type the formula "upper(prop("Name"))"
    And I close the formula editor with "the Done button"
    Then the formula "Notes" shows these values
      | ONE     |
      | TWO     |
      | <empty> |
    When I switch the property "Notes" to "Formula"
    Then the formula editor is closed

  Scenario: The property menu shows the saved formula and opens the editor
    Given a formula property "Double" with the expression "prop("Price") * 2"
    And a formula property "Blank" with the expression ""
    Then the property menu of "Blank" shows the formula item "Edit formula"
    And the property menu of "Double" shows the formula item "prop("Price") * 2"
    When I open the formula editor of "Double" from the property menu
    Then the formula editor title shows "Double"
    And the formula editor contains "prop("Price") * 2"

  Scenario: Clicking a formula cell opens the editor previewing that row
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I open the formula editor of "Double" by clicking its cell in row 2
    Then the formula editor contains "prop("Price") * 2"
    And the preview row is "Two"
    And the formula preview shows "8"

  Scenario: The row page opens the editor for its row
    Given a formula property "Label" with the expression "prop("Name") + "!""
    When I open the row page of row 2
    Then the row page shows the formula "Label" as "Two!"
    When I click the formula "Label" on the row page
    Then the formula editor contains "prop("Name") + "!""
    And the preview row is "Two"

  # ---------------------------------------------------------------------------
  # Committing and discarding
  # ---------------------------------------------------------------------------

  Scenario: Every way of leaving without saving discards the draft
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I open the formula editor of "Double" from the property menu
    And I type the formula "prop("Price") * 100"
    And I close the formula editor with "the Cancel button"
    Then the formula "Double" shows these values
      | 25 |
    When I open the formula editor of "Double" from the property menu
    Then the formula editor contains "prop("Price") * 2"
    When I type the formula "prop("Price") * 100"
    And I close the formula editor with "the close button"
    And I open the formula editor of "Double" from the property menu
    Then the formula editor contains "prop("Price") * 2"
    When I type the formula "prop("Price") * 100"
    And I close the formula editor with "Escape"
    And I open the formula editor of "Double" from the property menu
    Then the formula editor contains "prop("Price") * 2"
    When I type the formula "prop("Price") * 100"
    And I close the formula editor with "a click outside"
    And I open the formula editor of "Double" from the property menu
    Then the formula editor contains "prop("Price") * 2"
    And I close the formula editor with "the Cancel button"
    And the formula "Double" shows these values
      | 25 |
      | 8  |

  Scenario Outline: <method> saves the formula
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I open the formula editor of "Double" from the property menu
    And I type the formula "prop("Price") * 10"
    And I close the formula editor with "<method>"
    Then the formula editor is closed
    And the formula "Double" shows these values
      | 125 |
      | 40  |

    Examples:
      | method          |
      | the Done button |
      | Ctrl+Enter      |
      | Cmd+Enter       |

  Scenario: An invalid formula cannot be saved with Done or the keyboard
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I open the formula editor of "Double" from the property menu
    And I type the formula "prop("Price") *"
    Then the Done button is disabled
    When I press "Control+Enter" in the formula editor
    Then the formula editor is open with a formula
    When I press "Meta+Enter" in the formula editor
    Then the formula editor is open with a formula
    When I close the formula editor with "the Cancel button"
    Then the formula "Double" shows these values
      | 25 |

  # ---------------------------------------------------------------------------
  # Typing
  # ---------------------------------------------------------------------------

  Scenario: Enter and Shift+Enter add lines and Tab indents
    When I start a new formula property
    And I type the formula "if(true,"
    And I press "Enter" in the formula editor
    And I press "Tab" in the formula editor
    And I type "prop("Price")," in the formula editor
    And I press "Shift+Enter" in the formula editor
    And I press "Tab" in the formula editor
    And I type "0)" in the formula editor
    Then the formula editor contains "if(true,\n  prop("Price"),\n  0)"
    And the formula editor infers type "number"
    And the formula preview shows "12.5"

  Scenario: The formula is syntax highlighted while it is typed
    When I start a new formula property
    And I type the formula "/* note */ if(prop("Price") > 10, "big", not true) + 1"
    Then the formula editor highlights these tokens
      | text          | kind     |
      | /* note */    | comment  |
      | if            | function |
      | Price         | prop     |
      | >             | operator |
      | 10            | number   |
      | "big"         | string   |
      | not           | keyword  |
      | true          | keyword  |

  # ---------------------------------------------------------------------------
  # Property tokens
  # ---------------------------------------------------------------------------

  Scenario: A typed property reference becomes a token with the property's icon and name
    When I start a new formula property
    And I type "prop("Price"" in the formula editor
    Then the formula editor shows no property tokens
    When I type ")" in the formula editor
    Then the formula editor shows these property tokens
      | Price |
    And the property token "Price" shows its property type icon
    When I type " * 2" in the formula editor
    Then the formula editor contains "prop("Price") * 2"
    And the formula preview shows "25"

  Scenario: A saved formula opens with its references as tokens
    Given a formula property "Label" with the expression "prop("Name") + " " + prop("Notes")"
    When I open the formula editor of "Label" from the property menu
    Then the formula editor shows these property tokens
      | Name  |
      | Notes |
    And the formula editor contains "prop("Name") + " " + prop("Notes")"

  Scenario: Autocomplete and the catalogue insert property tokens
    When I start a new formula property
    And I type "ric" in the formula editor
    And I press "Enter" in the formula editor
    Then the formula editor shows these property tokens
      | Price |
    When I type " + length()" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I click the catalogue property "Name"
    Then the formula editor shows these property tokens
      | Price |
      | Name  |
    And the formula editor contains "prop("Price") + length(prop("Name"))"

  Scenario: The caret and Backspace treat a token as one unit
    When I start a new formula property
    And I type the formula "upper(prop("Name"))"
    And I press "End" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I type ""a" + " in the formula editor
    Then the formula editor contains "upper("a" + prop("Name"))"
    When I press "End" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I press "Backspace" in the formula editor
    Then the formula editor contains "upper("a" + )"
    And the formula editor shows no property tokens

  Scenario: Copying a formula gives prop() text and pasting prop() text gives tokens
    When I start a new formula property
    And I type the formula "prop("Price") * 2"
    And I copy the whole formula
    Then the copied formula is "prop("Price") * 2"
    When I clear the formula editor
    And I paste "prop("Name") + prop("Notes")" into the formula editor
    Then the formula editor shows these property tokens
      | Name  |
      | Notes |
    And the formula editor contains "prop("Name") + prop("Notes")"
    And the formula preview shows "Onealpha"

  Scenario: A reference to a missing property is a token marked as missing
    When I start a new formula property
    And I type the formula "prop("Nope") + 1"
    Then the property token "Nope" is marked as missing
    And the formula editor shows the error "Unknown property "Nope""

  Scenario: Shift+Arrow extends the selection over a whole token
    When I start a new formula property
    And I type the formula "1 + prop("Price") + 2"
    And I press "End" in the formula editor
    And I press "Shift+ArrowLeft" in the formula editor
    And I press "Shift+ArrowLeft" in the formula editor
    And I press "Shift+ArrowLeft" in the formula editor
    And I press "Shift+ArrowLeft" in the formula editor
    And I press "Shift+ArrowLeft" in the formula editor
    And I press "Backspace" in the formula editor
    Then the formula editor contains "1 + "
    And the formula editor shows no property tokens

  Scenario: Up and Down move between lines that hold tokens
    When I start a new formula property
    And I type the formula "1 + prop("Price") +\n2"
    And I press "ArrowUp" in the formula editor
    And I type "0" in the formula editor
    Then the formula editor contains "10 + prop("Price") +\n2"
    When I press "ArrowDown" in the formula editor
    And I type "0" in the formula editor
    Then the formula editor contains "10 + prop("Price") +\n20"
    And the formula editor shows these property tokens
      | Price |
    And the formula preview shows "42.5"

  Scenario: Clicking a token puts the caret after it
    When I start a new formula property
    And I type the formula "prop("Price") + 1"
    And I click the property token "Price"
    And I type " * 2" in the formula editor
    Then the formula editor contains "prop("Price") * 2 + 1"
    And the formula preview shows "26"

  Scenario: Undo and redo restore and remove a deleted token
    When I start a new formula property
    And I type the formula "prop("Price") + 1"
    And I press "Home" in the formula editor
    And I press "ArrowRight" in the formula editor
    And I press "Backspace" in the formula editor
    Then the formula editor contains " + 1"
    When I press "ControlOrMeta+z" in the formula editor
    Then the formula editor contains "prop("Price") + 1"
    And the formula editor shows these property tokens
      | Price |
    When I press "ControlOrMeta+Shift+z" in the formula editor
    Then the formula editor contains " + 1"
    And the formula editor shows no property tokens

  Scenario: A token follows a property renamed while the editor is open
    When I start a new formula property
    And I type the formula "upper(prop("Notes"))"
    And a collaborator renames the property "Notes" to "Memo"
    Then the formula editor shows these property tokens
      | Memo |
    And the formula editor contains "upper(prop("Memo"))"
    And the formula preview shows "ALPHA"
    When I close the formula editor with "the Done button"
    Then the last formula column shows these values
      | ALPHA   |
      | BETA    |
      | <empty> |

  Scenario: A token stays bound to the right property when two share a name
    When I add a "Number" property named "Price 2"
    And a collaborator sets row 1 of "Price 2" to "7"
    And a collaborator renames the property "Price 2" to "Price"
    And I start a new formula property
    And I click the catalogue property "Price 2"
    Then the formula editor shows these property tokens
      | Price |
    And the formula editor refers to "Price 2" by its id
    And the formula preview shows "7"
    When I close the formula editor with "the Done button"
    Then the last formula column shows these values
      | 7       |
      | <empty> |
      | <empty> |

  Scenario: Typing a name right before a token is an error, not a new reference
    When I start a new formula property
    And I type the formula "upper(prop("Name"))"
    And I press "Home" in the formula editor
    And I type "x" in the formula editor
    Then the formula editor contains "xupper(prop("Name"))"
    When I press "End" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I press "ArrowLeft" in the formula editor
    And I type "y" in the formula editor
    Then the formula editor contains "xupper(yprop("Name"))"
    And the formula editor shows these property tokens
      | Name |
    And the Done button is disabled

  # ---------------------------------------------------------------------------
  # Autocomplete
  # ---------------------------------------------------------------------------

  Scenario: Autocomplete is driven by the keyboard
    When I start a new formula property
    And I type "dateA" in the formula editor
    Then the autocomplete suggestions are
      | dateAdd() |
    When I type the formula "da"
    Then the autocomplete suggestions are
      | day()          |
      | date()         |
      | dateAdd()      |
      | dateSubtract() |
      | dateBetween()  |
      | dateRange()    |
      | dateStart()    |
      | dateEnd()      |
    And the active autocomplete suggestion is "day()"
    And the docs panel describes "day()"
    When I press "ArrowDown" in the formula editor
    Then the active autocomplete suggestion is "date()"
    And the docs panel describes "date()"
    When I press "ArrowUp" in the formula editor
    And I press "ArrowUp" in the formula editor
    Then the active autocomplete suggestion is "dateEnd()"
    When I press "Enter" in the formula editor
    Then the formula editor contains "dateEnd()"
    And the autocomplete is hidden
    When I type "today" in the formula editor
    Then the autocomplete suggests "today()"
    When I press "Tab" in the formula editor
    Then the formula editor contains "dateEnd(today())"
    And the formula editor shows no error

  Scenario: Autocomplete is driven by the mouse
    When I start a new formula property
    And I type "up" in the formula editor
    Then the autocomplete suggestions are
      | upper() |
    When I type the formula "le"
    Then the autocomplete suggests "length()"
    And the autocomplete suggests "lets()"
    When I hover the autocomplete suggestion "lets()"
    Then the active autocomplete suggestion is "lets()"
    And the docs panel describes "lets()"
    When I click the autocomplete suggestion "length()"
    Then the formula editor contains "length()"
    And the formula editor has focus

  Scenario: Autocomplete finds properties and keywords by partial name
    When I start a new formula property
    And I type "ric" in the formula editor
    Then the autocomplete suggests "Price"
    And the docs panel describes "Price"
    When I press "Enter" in the formula editor
    Then the formula editor contains "prop("Price")"
    When I type " > 1 and tr" in the formula editor
    Then the autocomplete suggests "true"
    And the autocomplete suggests "trim()"
    When I click the autocomplete suggestion "true"
    Then the formula editor contains "prop("Price") > 1 and true"
    And the formula editor infers type "boolean"

  Scenario: Autocomplete stays closed inside text and Escape only closes the popup
    When I start a new formula property
    And I type ""upp" in the formula editor
    Then the autocomplete is hidden
    When I type the formula "upp"
    Then the autocomplete suggests "upper()"
    When I press "Escape" in the formula editor
    Then the autocomplete is hidden
    And the formula editor is open with a formula
    When I press "Escape" in the formula editor
    Then the formula editor is closed

  # ---------------------------------------------------------------------------
  # Catalogue and docs
  # ---------------------------------------------------------------------------

  Scenario: The catalogue lists properties, built-ins and functions and can be searched
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I open the formula editor of "Double" from the property menu
    Then the formula catalogue sections are
      | Properties |
      | Built-ins  |
      | Functions  |
    And the formula editor lists the property "Name"
    And the formula editor lists the property "Price"
    And the formula editor lists the property "Notes"
    And the formula editor does not list the property "Double"
    And the formula editor lists the built-in "+"
    And the formula editor lists the built-in "current"
    And the formula editor lists the function "dateBetween"
    When I search the formula catalogue for "date"
    Then the formula catalogue sections are
      | Functions |
    And the formula editor lists the function "dateAdd"
    And the formula editor does not list the function "upper"
    When I search the formula catalogue for "pri"
    Then the formula catalogue sections are
      | Properties |
    When I search the formula catalogue for "zzz"
    Then the formula catalogue shows no results
    When I search the formula catalogue for ""
    Then the formula catalogue sections are
      | Properties |
      | Built-ins  |
      | Functions  |

  Scenario: Catalogue items insert at the caret
    When I start a new formula property
    And I type the formula "upper()"
    And I press "ArrowLeft" in the formula editor
    And I click the catalogue property "Name"
    Then the formula editor contains "upper(prop("Name"))"
    When I press "End" in the formula editor
    And I click the catalogue built-in "+"
    And I click the catalogue function "format"
    Then the formula editor contains "upper(prop("Name")) + format()"
    When I click the catalogue property "Price"
    Then the formula editor contains "upper(prop("Name")) + format(prop("Price"))"
    And the formula preview shows "ONE12.5"

  Scenario: The docs panel explains functions, built-ins and properties and inserts examples
    When I start a new formula property
    And I hover the catalogue function "substring"
    Then the docs panel describes "substring()"
    And the docs panel shows the signature "substring(text, startIndex, endIndex?)"
    And the docs panel reads "Returns the part of the text from the start index"
    And the docs panel shows the example "substring("Notion", 0, 3)" with result ""Not""
    When I hover the catalogue built-in "%"
    Then the docs panel describes "%"
    And the docs panel reads "Returns the remainder of a division."
    When I hover the catalogue property "Price"
    Then the docs panel describes "Price"
    And the docs panel reads "Property of type number."
    And the docs panel shows the example "prop("Price") * 2" with result "double the number"
    When I insert the docs example "prop("Price") * 2"
    Then the formula editor contains "prop("Price") * 2"
    And the formula preview shows "25"

  # ---------------------------------------------------------------------------
  # Types, errors, preview
  # ---------------------------------------------------------------------------

  Scenario: The editor infers the result type while typing
    When I start a new formula property
    Then these formulas infer these types
      | expression                         | type       |
      | prop("Price") + 1                  | number     |
      | prop("Name") + "!"                 | text       |
      | prop("Price") > 1                  | boolean    |
      | now()                              | date       |
      | split(prop("Notes"), "")           | list<text> |
      | [1, 2].map(current * 2)            | list<number> |
      | if(true, empty(), 3)               | number     |
      | empty()                            | empty      |
      | prop("Name") + 1                   | text       |
      | "Due " + now()                     | text       |
      | prop("Name") - 1                   | any        |

  Scenario: The editor explains errors with their position
    When I start a new formula property
    Then these formulas show these errors
      | expression                  | error                                                             |
      | "a" - 1                     | "-" expects a number, got text [1,1]                              |
      | prop("Price") +             | Unexpected end of formula [1,16]                                  |
      | if(true,\n  1 +             | Unexpected end of formula [2,6]                                   |
      | foo(1)                      | Unknown function "foo" [1,1]                                      |
      | prop("Nope")                | Unknown property "Nope" [1,1]                                     |
      | if(true, 1)                 | if() expects 3 arguments [1,1]                                    |
      | if(true, 1, "a")            | if() branches must have the same type: number vs text [1,13]      |
      | upper(prop("Price"))        | upper() expects text for "text", got number [1,7]                 |
      | 1 < 2 < 3                   | Comparisons cannot be chained; combine them with "and" [1,7]      |
      | "open                       | Unterminated string [1,1]                                         |
      | current                     | Unknown variable or function "current" [1,1]                      |
      | [1, 2].filter(current + 1)  | filter() expects a condition that returns a boolean [1,15]        |
    And the Done button is disabled

  Scenario: The preview follows the chosen row and shows empty results as a dash
    When I start a new formula property
    Then the preview row choices are
      | One   |
      | Two   |
      | Row 3 |
    When I type the formula "prop("Notes")"
    Then the formula preview shows "alpha"
    When I choose the preview row "Two"
    Then the formula preview shows "beta"
    When I choose the preview row "Row 3"
    Then the formula preview shows "—"
    When I type the formula "prop("Notes") +"
    Then the formula preview shows ""
