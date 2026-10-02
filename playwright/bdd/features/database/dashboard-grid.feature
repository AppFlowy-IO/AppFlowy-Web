@dashboard @cloud
Feature: Dashboard grid geometry
  Rows keep one box model in View and Edit mode: 16 pixels between rows,
  24 pixels between cards. A row wraps when a widget would be narrower than
  240 pixels (4 to 2x2, 3 to 2 plus 1, 2 to 1), keeping its height. Handles
  stay hidden until hovered, keep widgets at least 2 columns and 240 pixels
  wide, and snap row heights to 20 pixels.

  Scenario: A row of four wraps into two by two and never three up
    Given a dashboard with rows of "4" widgets is open
    When the dashboard rows are 1004 pixels wide
    Then the dashboard row 1 is laid out in lines of "4"
    When the dashboard rows are 954 pixels wide
    Then the dashboard row 1 is laid out in lines of "2, 2"
    And every line of the dashboard row 1 is 360 pixels tall with 16 pixels between lines
    When the dashboard rows are 444 pixels wide
    Then the dashboard row 1 is laid out in lines of "1, 1, 1, 1"

  Scenario: A row of three wraps into two plus one full-width widget
    Given a dashboard with rows of "3" widgets is open
    When the dashboard rows are 744 pixels wide
    Then the dashboard row 1 is laid out in lines of "3"
    When the dashboard rows are 704 pixels wide
    Then the dashboard row 1 is laid out in lines of "2, 1"
    And the last widget of the dashboard row 1 spans the full row width
    When the dashboard rows are 444 pixels wide
    Then the dashboard row 1 is laid out in lines of "1, 1, 1"

  Scenario: A wrapped row ignores custom widths until it fits again
    Given a dashboard with rows of "2" widgets is open
    And the user enters dashboard edit mode
    When the dashboard rows are 1244 pixels wide
    And the user drags dashboard width handle 1 of row 1 by 2 columns
    Then the dashboard row 1 has widths "8, 4"
    When the dashboard rows are 444 pixels wide
    Then the dashboard row 1 is laid out in lines of "1, 1"
    And the dashboard row 1 has no width handles
    And the dashboard row 1 has widths "8, 4"
    When the dashboard rows are 1244 pixels wide
    Then the dashboard row 1 is laid out in lines of "2"
    And the widgets of the dashboard row 1 are 821 and 411 pixels wide

  Scenario: Entering and leaving Edit mode moves no widget
    Given a dashboard with rows of "3, 1" widgets is open
    Then the dashboard rows are 16 pixels apart
    And the cards of the dashboard row 1 are 24 pixels apart
    When the user remembers the positions of the dashboard widgets
    And the user enters dashboard edit mode
    Then every dashboard widget is where it was
    And the dashboard rows are 16 pixels apart
    When the user leaves dashboard edit mode
    Then every dashboard widget is where it was

  Scenario: The width handle keeps both neighbours at least 240 pixels wide
    Given a dashboard with rows of "3" widgets is open
    And the user enters dashboard edit mode
    When the dashboard rows are 1004 pixels wide
    And the user drags dashboard width handle 1 of row 1 by 3 columns
    Then the dashboard row 1 has widths "5, 3, 4"
    And every widget of the dashboard row 1 is at least 240 pixels wide
    When the user drags dashboard width handle 1 of row 1 by -3 columns
    Then the dashboard row 1 has widths "3, 5, 4"

  Scenario: The height handle snaps rows to 20 pixels without a size badge
    Given a dashboard with rows of "2" widgets is open
    And the user enters dashboard edit mode
    When the user starts dragging the height handle of dashboard row 1 by 50 pixels
    Then the dashboard row 1 previews a height of 420 pixels
    And the dashboard shows no row height badge
    When the user releases the height handle
    Then the dashboard row 1 is 420 pixels tall
    When the user drags the height handle of dashboard row 1 by 111 pixels
    Then the dashboard row 1 is 540 pixels tall
    When the user drags the height handle of dashboard row 1 by -1000 pixels
    Then the dashboard row 1 is 240 pixels tall

  Scenario: Width handles stay hidden until their gap is hovered
    Given a dashboard with rows of "2" widgets is open
    And the user enters dashboard edit mode
    Then width handle 1 of the dashboard row 1 is hidden
    When the user hovers the dashboard row 1
    Then width handle 1 of the dashboard row 1 is hidden
    When the user hovers width handle 1 of the dashboard row 1
    Then width handle 1 of the dashboard row 1 shows a faint pill

  Scenario: Row controls sit in the page gutter, centred on a wrapped row
    Given a dashboard with rows of "3" widgets is open
    And the user enters dashboard edit mode
    When the dashboard rows are 704 pixels wide
    And the user hovers the dashboard row 1
    Then the row controls of the dashboard row 1 sit 30 pixels outside the row, centred on it
