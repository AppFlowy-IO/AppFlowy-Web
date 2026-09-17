@dashboard @cloud
Feature: Dashboard widgets
  Widgets render existing database views from the host database or any other
  database in the workspace. The picker adds existing views or creates a new
  one, the widget menu opens, duplicates and deletes widgets, and a dashboard
  holds at most 12 widgets with at most 4 per row. Widgets whose view is gone
  or not accessible keep their place and explain why.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"

  Scenario: The picker adds an existing view of the host database
    When I open the widget picker
    And I pick the "Projects Grid" view in the widget picker
    Then the dashboard shows 1 widget
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    And the dashboard layout setting references the "Projects Grid" view in row 1

  Scenario: Searching the picker adds a view from another database
    When I open the widget picker
    And I search the widget picker for "Tasks" and pick the "Tasks Grid" view
    Then the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"
    And the dashboard layout setting references the "Tasks Grid" view in row 1

  Scenario: The picker creates a new board view for the dashboard
    When I open the widget picker
    And I create a new "Board" view of "Projects" from the widget picker
    Then the dashboard shows 1 widget
    And the widget shows a new "Board" view of "Projects"
    And the new board widget shows the "Doing" column

  Scenario: The widget header shows the view title
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
    Then the "Projects Grid" widget header shows its view name
    And the "Tasks Grid" widget header shows its view name

  Scenario: Open view navigates to the widget's database view
    Given the dashboard has these widgets:
      | row | widget     |
      | 1   | Tasks Grid |
    When I choose "open" in the "Tasks Grid" widget menu
    Then the "Tasks Grid" view is open outside the dashboard

  Scenario: Duplicate places a copy of the widget next to it
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    When I choose "duplicate" in the "Projects Grid" widget menu
    Then the dashboard shows 2 widgets
    And dashboard row 1 has 2 widgets showing the "Projects Grid" view
    And every dashboard row spans 12 columns

  Scenario: Delete removes the widget but not its view
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    When I choose "delete" in the "Projects Grid" widget menu
    Then the dashboard shows 0 widgets
    And the dashboard shows its empty state with an Add widget button
    And the dashboard layout setting exists with 0 widgets
    And the "Projects" database still has its "Grid" view

  Scenario: The row add button inserts a widget into that row
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    When I add the "Tasks Grid" view through the add button of dashboard row 1
    Then dashboard row 1 holds "Projects Grid, Tasks Grid"
    And the widths of dashboard row 1 are "6, 6"

  Scenario: A thirteenth widget is refused
    Given the dashboard has 12 widgets in 3 full rows
    Then adding another widget is refused with the widget limit message
    And the dashboard shows 12 widgets

  Scenario: A fifth widget in a row is refused
    Given the dashboard has these widgets:
      | row | widget           |
      | 1   | Projects Grid    |
      | 1   | Tasks Grid       |
      | 1   | Notes Grid       |
      | 1   | Projects Grid #2 |
      | 2   | Tasks Grid #2    |
    Then dashboard row 1 offers no add widget button
    And dashboard row 2 offers an add widget button
    When I drag the "Tasks Grid #2" widget onto the right side of the "Notes Grid" widget
    Then dashboard row 1 holds "Projects Grid, Tasks Grid, Notes Grid, Projects Grid #2"
    And dashboard row 2 holds "Tasks Grid #2"

  Scenario: A widget whose view was trashed shows the not-found placeholder
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
    When the "Tasks" database is moved to the trash
    And I reload the dashboard
    Then the "Tasks Grid" widget shows the "not-found" placeholder
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    When I click the dashboard Edit button
    And I remove the "Tasks Grid" widget from its placeholder
    Then the dashboard shows 1 widget

  Scenario: A member without access to a widget's database sees the no-access placeholder
    Given the owner keeps a "Secrets" database in a space the member cannot open
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Secrets Grid  |
    And a workspace member with "read-and-write" access to the dashboard space
    When the member opens the dashboard
    Then the member sees the "Secrets Grid" widget with the "no-access" placeholder
    And the member sees the "Projects Grid" widget with 3 rows
