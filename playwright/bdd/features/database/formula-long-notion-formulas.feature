@formula @formula-long-formulas
Feature: Long formulas pasted from Notion
  AppFlowy issue #9039: long, multi-line Notion formulas pasted into the
  formula editor overflowed the input box, and formulas using Notion's
  style() did not work. The editor keeps a long formula inside a box that
  scrolls on its own, so the preview and the function list stay in view,
  and style()/unstyle() are accepted (formula results are plain text, so
  the styles are not shown).

  The reporter's formulas are pasted verbatim. They refer to properties
  whose names have a trailing space ("Next ") and doubled spaces
  (" Start  Date"), which a table cannot hold, so those are renamed.

  Scenario: The reporter's status formula stays inside the editor and computes every status
    Given a Grid for formula testing with these properties
      | property        | type     | row 1   | row 2   | row 3   | row 4   | row 5   | row 6   | row 7   |
      | Name            | Text     | Done    | Archive | Next    | Hold    | Due     | Blank   | Future  |
      | Done            | Checkbox | yes     | no      | no      | no      | no      | no      | no      |
      | Archives        | Checkbox | no      | yes     | no      | no      | no      | no      | no      |
      | Next            | Checkbox | no      | no      | yes     | no      | no      | no      | no      |
      | Hold            | Checkbox | no      | no      | no      | yes     | no      | no      | no      |
      | Snooze Deadline | Date     | today+9 | today+9 | today+9 | today+9 | today+3 | <empty> | today+40 |
      | Deadline Date   | Date     | today+5 | today+5 | today+5 | today+5 | today   | <empty> | today+35 |
      | Start Date      | Date     | today-2 | today-2 | today-2 | today-2 | today-2 | <empty> | today+28 |
      | Completed       | Number   | 3       | 3       | 3       | 3       | 10      | <empty> | 0       |
      | Goal            | Number   | 10      | 10      | 10      | 10      | 10      | 10      | 10      |
    And I rename the property "Next" to "Next "
    And I rename the property "Start Date" to " Start  Date"
    When I start a new formula property
    And I paste the reporter's "status" formula into the formula editor
    Then the formula editor shows no error
    And the formula editor infers type "text"
    And the formula input scrolls inside its own box
    And the formula input is no taller than 40% of the window
    And the end of the formula is scrolled into view
    And the formula preview and the function list are visible without scrolling the dialog
    And the formula preview shows "✅Done"
    When I close the formula editor with "the Done button"
    # Like Notion, empty(0) is true, so the last row appends "0%" to the rounded 0.
    Then the formula "Formula" shows these values
      | ✅Done                                |
      | 🗃️ Archive                            |
      | 🔵 Next goal ➜  ██░░░░░░░ 30%          |
      | ▶️ Hold  ➜  ██░░░░░░░ 30%              |
      | ⏰ In progress ➜ 100% Completed 💪     |
      | ▶ Not Started                         |
      | ↗ The future ➜ ░░░░░░░░░░ 00%         |

  Scenario: The reporter's Hijri month formula stays inside the editor and names the month
    Given a Grid for formula testing with these properties
      | property   | type | row 1      | row 2      | row 3      | row 4   |
      | Name       | Text | Sha'ban    | Ramadan    | Muharram   | Blank   |
      | Start Date | Date | 2024-03-03 | 2024-03-20 | 2024-07-10 | <empty> |
    And I rename the property "Start Date" to " Start  Date"
    When I start a new formula property
    And I paste the reporter's "Hijri month" formula into the formula editor
    Then the formula editor shows no error
    And the formula editor infers type "text"
    And the formula input scrolls inside its own box
    And the formula input is no taller than 40% of the window
    And the formula preview and the function list are visible without scrolling the dialog
    And the formula preview shows "📅 شعبان"
    When I close the formula editor with "the Done button"
    Then the formula "Formula" shows these values
      | 📅 شعبان   |
      | 📅 رمضان   |
      | 📅 محرم    |
      | <empty>   |

  Scenario: A short formula keeps the input at its normal size
    Given a Grid for formula testing with these properties
      | property | type | row 1 |
      | Name     | Text | One   |
    When I start a new formula property
    And I type the formula "upper(prop("Name"))"
    Then the formula preview shows "ONE"
    And the formula input is no taller than 10% of the window

  Scenario: style() and unstyle() accept Notion styles and keep the text
    Given a Grid for formula testing with these properties
      | property | type | row 1 | row 2 |
      | Name     | Text | Late  | Done  |
    When I start a new formula property
    Then these formulas infer these types
      | expression                                          | type |
      | prop("Name").style("c", "b", "red", "red_background") | text |
      | unstyle(prop("Name"), "b")                          | text |
    When I hover the catalogue function "style"
    Then the docs panel describes "style()"
    And the docs panel shows the signature "style(text, style1, style2, ...)"
    And the docs panel reads "so the styles are not applied"
    When I type the formula "prop("Name").style("b", "red") + "!".unstyle()"
    Then the formula editor shows no error
    And the formula preview shows "Late!"
    When I close the formula editor with "the Done button"
    Then the formula "Formula" shows these values
      | Late! |
      | Done! |
