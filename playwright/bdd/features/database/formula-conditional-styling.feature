@formula @formula-conditional-styling
Feature: Conditional styling of formula text
  A conversion formula pasted from Notion preserves the red text requested by
  style() when the rounded conversion exceeds 90. Exactly 90 keeps the default
  text color, including values rounded down to 90.

  Scenario: The reporter's conversion CSV renders conditional colors and updates them live
    Given a Grid with the reporter's conversion CSV
    When I start a new formula property
    And I paste the reporter's conditional conversion formula
    Then the formula editor shows no error
    And the formula editor infers type "text"
    And the formula preview shows "0"
    When I close the formula editor with "the Done button"
    Then the conversion formula matches the reporter's expected text and colors
      | row                       | value | color   |
      | No completed work         | 0     | default |
      | Low conversion            | 20    | default |
      | Half completed            | 50    | default |
      | High conversion           | 90    | default |
      | Just above threshold      | 91    | red     |
      | Very high conversion      | 95    | red     |
      | Fully completed           | 100   | red     |
      | Rounding below threshold  | 90    | default |
      | Rounding above threshold  | 91    | red     |
      | Small numbers             | 33    | default |
      | Uneven ratio              | 70    | default |
      | Zero denominator          | 0     | default |
    When I open the formula editor of "Formula" by clicking its cell in row 5
    Then the formula preview shows "91"
    And the conversion formula preview text is "red"
    When I close the formula editor with "the Done button"
    And I type "9" into row 5 of "Done"
    And I type "1" into row 5 of "In progress"
    Then the conversion formula matches the reporter's expected text and colors
      | row                  | value | color   |
      | Just above threshold | 90    | default |
    When I type "19" into row 5 of "Done"
    Then the conversion formula matches the reporter's expected text and colors
      | row                  | value | color |
      | Just above threshold | 95    | red   |
    When I reload the grid
    Then the conversion formula matches the reporter's expected text and colors
      | row                      | value | color   |
      | High conversion          | 90    | default |
      | Just above threshold     | 95    | red     |
      | Very high conversion     | 95    | red     |
      | Fully completed          | 100   | red     |
      | Rounding below threshold | 90    | default |
      | Rounding above threshold | 91    | red     |
      | Zero denominator         | 0     | default |

  Scenario: Every supported style paints exactly its requested properties and can be cleared
    Given a Grid for formula testing with these properties
      | property | type | row 1 |
      | Name     | Text | One   |
    And a formula property "Styles" with the expression ""Styled Plain""
    Then each formula style option has these rendered properties and clears completely
      | option            | formats | foreground             | background           |
      | b                 | b       | default                | default              |
      | i                 | i       | default                | default              |
      | u                 | u       | default                | default              |
      | s                 | s       | default                | default              |
      | c                 | c       | default                | --fill-secondary     |
      | gray              | none    | --palette-text-color-19 | default              |
      | brown             | none    | --palette-text-color-2  | default              |
      | orange            | none    | --palette-text-color-3  | default              |
      | yellow            | none    | --palette-text-color-5  | default              |
      | green             | none    | --palette-text-color-9  | default              |
      | blue              | none    | --palette-text-color-12 | default              |
      | purple            | none    | --palette-text-color-15 | default              |
      | pink              | none    | --palette-text-color-18 | default              |
      | red               | none    | --palette-text-color-1  | default              |
      | gray_background   | none    | default                | --palette-bg-color-19 |
      | brown_background  | none    | default                | --palette-bg-color-2  |
      | orange_background | none    | default                | --palette-bg-color-3  |
      | yellow_background | none    | default                | --palette-bg-color-5  |
      | green_background  | none    | default                | --palette-bg-color-9  |
      | blue_background   | none    | default                | --palette-bg-color-12 |
      | purple_background | none    | default                | --palette-bg-color-15 |
      | pink_background   | none    | default                | --palette-bg-color-18 |
      | red_background    | none    | default                | --palette-bg-color-1  |

  Scenario: Mixed runs combine styles, override colors and remove only requested formatting
    Given a Grid for formula testing with these properties
      | property | type | row 1 |
      | Name     | Text | One   |
    And a formula property "Styles" with the expression ""Styled Plain""
    Then these formula expressions paint exactly the requested styled and plain runs
      | expression                                                                                                                 | formats   | foreground            | background           |
      | style("Styled", "b", "i", "u", "s", "c", "red", "blue_background") + " Plain"                                                | b i u s c | --palette-text-color-1 | --palette-bg-color-12 |
      | unstyle(style("Styled", "b", "i", "u", "s", "c", "red", "blue_background"), "b", "u", "red", "blue_background") + " Plain" | i s c     | default               | --fill-secondary     |
      | unstyle(style("Styled", "b", "i", "u", "s", "c", "red", "blue_background")) + " Plain"                                      | none      | default               | default              |
      | style("Styled", "red").style("green", "yellow_background") + " Plain"                                                      | none      | --palette-text-color-9 | --palette-bg-color-5  |
      | style("Styled", "b", "red") + unstyle(style(" Plain", "i", "blue_background"))                                             | b         | --palette-text-color-1 | default              |
