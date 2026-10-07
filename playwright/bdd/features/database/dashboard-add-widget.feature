@dashboard @cloud
Feature: Adding dashboard widgets
  Clicking a "+" inserts a selected Count all Number widget straight away and
  opens the "New view" picker beside it. Picking an existing view swaps the
  widget to it, picking a new view type turns the widget's own view into that
  type, and closing the picker keeps the Number widget. An empty dashboard
  invites editors to build it.

  Background:
    Given a "Projects" database with 3 rows and an empty dashboard open in Edit mode

  Scenario: The empty dashboard in Edit mode offers a New view placeholder
    Then the empty dashboard shows a placeholder widget with 5 view icons and a "New view" button
    And the empty dashboard shows no border and no "Edit dashboard" button

  Scenario: Clicking New view inserts a selected Count all number widget and opens the picker beside it
    When the user clicks "New view" in the empty dashboard
    Then the dashboard shows 1 widget
    And the new widget is selected
    And the new widget is titled "Chart"
    And the new widget shows the number "3" with the caption "Count all"
    And the new widget's chart is saved as a compact Count all Number chart
    And the "New view" picker is open beside the new widget with its search focused
    And the picker lists "Views on Projects" before the new view types
    And the picker's new view types are "Table, Board, Gallery, List, Chart, Timeline, Feed, Calendar"

  Scenario: Closing the picker keeps the Count all widget
    When the user clicks "New view" in the empty dashboard
    And the user closes the "New view" picker
    Then the dashboard shows 1 widget
    And the new widget shows the number "3" with the caption "Count all"
    And the new widget is selected
    When the user presses Escape
    Then no dashboard widget is selected

  Scenario: Picking an existing view swaps the new widget without leaving a spare view
    When the user clicks "New view" in the empty dashboard
    And the user picks the "Grid" view in the "New view" picker
    Then the dashboard shows 1 widget
    And the new widget shows the "Grid" view of "Projects"
    When the user clicks the dashboard Done button
    Then the "Projects" database has 0 views created by the dashboard

  Scenario: Picking a new view type turns the new widget into that view
    When the user clicks "New view" in the empty dashboard
    And the user chooses the new view type "Board" in the "New view" picker
    Then the new widget shows a "Board" view of "Projects"
    And the new widget is titled "Board"
    And the "New view" panel shows the view name "Board" with the "Board" layout selected
    And the "Projects" database has 1 views created by the dashboard

  Scenario: Edit chart opens the chart settings docked beside the new widget
    When the user clicks "New view" in the empty dashboard
    And the user chooses the new view type "Chart" in the "New view" picker
    And the user clicks "Edit chart"
    Then the "View settings" popover is open beside the new widget
    And the new widget is selected
    And the chart type "Number" is selected in the view settings

  Scenario: Undo removes the added widget in one step
    When the user clicks "New view" in the empty dashboard
    And the user closes the "New view" picker
    And the user presses undo on the dashboard
    Then the dashboard shows 0 widgets
    And the empty dashboard shows a placeholder widget with 5 view icons and a "New view" button

  Scenario: The row add button adds the widget to that row and splits the row equally
    Given the dashboard shows the "Grid" view of "Projects" in row 1
    When the user clicks the add button of dashboard row 1
    Then dashboard row 1 has widths "6, 6"
    And the second widget of dashboard row 1 is the selected Count all widget
    And the "New view" picker is open beside the new widget with its search focused

  Scenario: Searching the picker covers existing views and new view types
    Given a "Tasks" database with 2 rows
    When the user clicks "New view" in the empty dashboard
    And the user types "Tasks" in the "New view" picker search
    Then the picker lists the "Grid" view of "Tasks" under "Other data sources"
    And the picker lists no new view types
    When the user types "Bo" in the "New view" picker search
    Then the picker's new view types are "Board"

  Scenario: The picker shows five views of the dashboard's database and reveals the rest
    Given the "Projects" database also has the views "Alpha, Beta, Gamma, Delta, Epsilon, Zeta"
    When the user clicks "New view" in the empty dashboard
    Then the picker lists 5 views under "Views on Projects" and offers "Show 2 more"
    When the user clicks "Show 2 more"
    Then the picker lists 7 views under "Views on Projects"

  Scenario: A full dashboard refuses the add without creating a view
    Given the dashboard has 12 widgets in 3 full rows
    When the user tries to add a widget from the add button under the last row
    Then the add is refused with "Dashboard is full" and "Delete a view to add a new one"
    And no "New view" picker is open
    And the "Projects" database has the same views as before

  Scenario: The empty dashboard in View mode invites editors to edit it
    When the user clicks the dashboard Done button
    Then the empty dashboard reads "Add charts, tables, lists" above an "Edit dashboard" button and its illustration
    And the empty dashboard shows no border and no "New view" button
    When the user clicks "Edit dashboard"
    Then the dashboard is in Edit mode
    And the empty dashboard shows a placeholder widget with 5 view icons and a "New view" button

  Scenario: A workspace that cannot create charts gets a table widget instead
    Given chart views cannot be created in this workspace
    When the user clicks "New view" in the empty dashboard
    Then the dashboard shows 1 widget
    And the new widget is titled "Table"
    And the new widget shows the "Table" view of "Projects" as a table
    And the "New view" picker is open beside the new widget with its search focused
