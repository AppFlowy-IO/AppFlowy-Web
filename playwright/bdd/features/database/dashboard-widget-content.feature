@dashboard @cloud
Feature: Dashboard widget content: search, New, board sort, color columns and column calculations
  Table, list and board widgets search their rows for the current session
  only. Editors create rows from the widget's New button. Sorting a board
  orders cards inside each column. Color columns tint each column with its
  option color, and a board column can show a calculation instead of its
  card count.

  Background:
    Given the dashboard fixture workspace is ready
    And "Projects" also has a "Board" view
    And "Projects" also has a "Chart" view
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Grid  |
      | 1   | Projects Board |
      | 2   | Projects Chart |
    And I reload the dashboard

  Scenario: Widget headers offer Search and New in View mode only
    Then the "Projects Grid" widget header offers "Filter, Sort, Search, New"
    And the "Projects Board" widget header offers "Filter, Sort, Search, New"
    And the "Projects Chart" widget header offers "Filter"
    When I click the dashboard Edit button
    Then the "Projects Grid" widget header offers "Filter, Sort, Settings"
    And the "Projects Board" widget header offers "Filter, Sort, Settings"

  Scenario: A table widget searches its rows and offers to clear an empty result
    When I search the "Projects Grid" widget for "launch"
    Then the "Projects Grid" widget shows the rows "Website launch"
    And the "Projects Board" widget shows 3 cards
    When I search the "Projects Grid" widget for "  DOING  "
    Then the "Projects Grid" widget shows the rows "Website launch"
    When I search the "Projects Grid" widget for "zzqx"
    Then the "Projects Grid" widget says "No results"
    When I click "Clear search" in the "Projects Grid" widget
    Then the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    And the "Projects Grid" widget search box is closed

  Scenario: A widget search is never saved
    When I search the "Projects Grid" widget for "mobile"
    Then the "Projects Grid" widget shows the rows "Mobile app"
    And the "Projects Grid" view has 0 saved filters
    When I reload the dashboard
    Then the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"

  Scenario: Entering Edit mode clears a widget search
    When I search the "Projects Grid" widget for "mobile"
    And I click the dashboard Edit button
    Then the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"

  Scenario: A board widget searches its cards
    When I search the "Projects Board" widget for "mobile"
    Then the "Projects Board" widget shows 1 card
    And the "Todo" column of the "Projects Board" widget shows 1 card
    When I search the "Projects Board" widget for "zzqx"
    Then the "Projects Board" widget says "No results"

  Scenario: The New button of a table widget creates a row
    When I click "New" in the "Projects Grid" widget header
    Then a new row page is open
    When I close the row page
    Then the "Projects Grid" widget shows 4 rows
    When I open the templates menu of the "Projects Grid" widget
    Then the templates menu is open

  Scenario: A sorted board orders cards inside each column and keeps the column order
    Given "Projects" also has the rows:
      | Name      | Status | Estimate |
      | Beta test | Doing  | 1        |
    When I sort the "Projects Board" widget by "Estimate" "descending"
    Then the "Doing" column of the "Projects Board" widget lists "Website launch, Beta test"
    And the "Projects Board" widget lists the columns "Todo, Doing, Done" in that order
    And the "Projects Board" view has 0 saved sorts

  Scenario: Dragging a card in a sorted board keeps its sorted place
    Given "Projects" also has the rows:
      | Name      | Status | Estimate |
      | Beta test | Doing  | 1        |
    And I sort the "Projects Board" widget by "Estimate" "descending"
    When I drag the "Beta test" card above "Website launch" in the "Projects Board" widget
    Then the "Doing" column of the "Projects Board" widget lists "Website launch, Beta test"
    When I drag the "Mobile app" card to the "Doing" column of the "Projects Board" widget
    Then the "Doing" column of the "Projects Board" widget lists "Mobile app, Website launch, Beta test"
    And the "Mobile app" row of "Projects" has "Doing" as its "Status"

  Scenario: A board column shows a calculation instead of its card count
    Then the "Doing" column header of the "Projects Board" widget shows "1"
    When I set the column calculation of the "Projects Board" widget to "Sum" of "Estimate"
    Then the "Todo" column header of the "Projects Board" widget shows "5"
    And the "Doing" column header of the "Projects Board" widget shows "3"
    And the "Done" column header of the "Projects Board" widget shows "8"
    And the "Projects Board" view saves the column calculation "Sum" of "Estimate"
    When I search the "Projects Board" widget for "website"
    Then the "Doing" column header of the "Projects Board" widget shows "3"
    And the "Todo" column header of the "Projects Board" widget shows no calculation
    When I set the column calculation of the "Projects Board" widget to "Count all"
    Then the "Doing" column header of the "Projects Board" widget shows "1"

  Scenario: Color columns tint board columns with their option color
    Given the "Projects Board" view has color columns turned on
    Then the "Doing" column of the "Projects Board" widget is tinted with the "Doing" option color
    And the "Todo" column of the "Projects Board" widget is tinted with the "Todo" option color
    When I click the dashboard Edit button
    And I turn off "Color columns" in the settings of the "Projects Board" widget
    Then the "Doing" column of the "Projects Board" widget is not tinted
    And the "Projects Board" view saves color columns as turned off

  Scenario: A read-only member can search a widget but cannot create rows
    Given a workspace member with "read-only" access to the dashboard space
    When the member opens the dashboard
    Then the member sees the "Projects Grid" widget header offer "Filter, Sort, Search"
    When the member searches the "Projects Grid" widget for "mobile"
    Then the member sees the "Projects Grid" widget show the rows "Mobile app"
    And the "Projects Grid" view has 0 saved filters

  Scenario: The new-row button of a grid widget reads "New page"
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the new-row button of the "Grid" widget reads "New page"
