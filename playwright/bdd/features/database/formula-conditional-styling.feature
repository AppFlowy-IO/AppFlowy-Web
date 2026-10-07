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
