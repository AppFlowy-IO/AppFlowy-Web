@dashboard @cloud
Feature: Dashboard-owned widget views
  Views created for widgets belong to their dashboard: they are not database
  tabs, duplicates copy them with numbered names, the widget renames them, and
  deleting a widget removes the view it owned once editing is done.

  Scenario: The active tab is scrolled into view when the database opens
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And "Projects" has 12 more "Grid" views before the dashboard tab
    When the user reopens the "Projects" database on the dashboard tab
    Then the active tab is fully visible in the tab bar

  Scenario: Converting a view to a dashboard keeps it as the first widget
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And "Projects" has a "Board" view named "Pipeline"
    When the user switches the "Pipeline" view of "Projects" to the Dashboard layout
    Then the dashboard has 1 widget
    And dashboard row 1 has widths "12"
    And dashboard row 1 is 360 pixels tall
    And widget 1 is titled "Pipeline"
    And widget 1 shows a "Board" view with the groups of the original "Pipeline" view
    And the view of widget 1 belongs to the dashboard
    And the "Projects" tab bar shows "Pipeline" with the dashboard icon

  Scenario: A view created for a widget belongs to the dashboard and is not a database tab
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    When the user creates a new "Board" view of "Projects" from the widget picker
    Then the dashboard has 1 widget
    And widget 1 is titled "Board"
    And the view of widget 1 belongs to the dashboard
    And the "Projects" tab bar does not show the view of widget 1
    And the "Projects" tab bar shows the dashboard tab as active

  Scenario: New widget views of the same layout get numbered names
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    When the user creates a new "Board" view of "Projects" from the widget picker
    And the user creates a new "Board" view of "Projects" from the widget picker
    Then widget 1 is titled "Board"
    And widget 2 is titled "Board (1)"

  Scenario: Picking an existing view keeps it as a database tab
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    When the user adds the "Grid" view of "Projects" from the widget picker
    Then the view of widget 1 does not belong to the dashboard
    And the "Projects" tab bar shows the "Grid" view

  Scenario: Duplicating a widget copies its view with a numbered name
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user adds the "Grid" view of "Projects" from the widget picker
    When the user duplicates widget 1
    Then the dashboard has 2 widgets
    And dashboard row 1 has widths "6, 6"
    And widget 2 is titled "Grid (1)"
    And widget 2 shows a different view than widget 1
    And widget 2 has the same filters, sorts and settings as widget 1
    And the view of widget 2 belongs to the dashboard
    And the "Projects" tab bar does not show the view of widget 2

  Scenario: Undoing a duplicate removes the copied view once editing is done
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user adds the "Grid" view of "Projects" from the widget picker
    When the user duplicates widget 1
    And the user undoes the last dashboard change
    Then the dashboard has 1 widget
    When the user clicks Done
    Then the copied view no longer exists in "Projects"

  Scenario: Duplicate on a full dashboard creates no view
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the dashboard has 12 widgets in 3 full rows
    When the user tries to duplicate widget 1
    Then the dashboard has 12 widgets
    And the "Projects" database has no new views

  Scenario: Deleting a widget removes the view it owned once editing is done
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user creates a new "Board" view of "Projects" from the widget picker
    When the user deletes widget 1
    Then the dashboard has 0 widgets
    And the view that widget 1 showed still exists in "Projects"
    When the user undoes the last dashboard change
    Then the dashboard has 1 widget
    And widget 1 is titled "Board"
    When the user deletes widget 1
    And the user clicks Done
    Then the view that widget 1 showed no longer exists in "Projects"

  Scenario: Deleting a widget keeps a view it did not own
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user adds the "Grid" view of "Projects" from the widget picker
    When the user deletes widget 1
    And the user clicks Done
    Then the "Projects" tab bar shows the "Grid" view

  Scenario: Renaming a widget renames its view
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user creates a new "Board" view of "Projects" from the widget picker
    When the user renames widget 1 to "Pipeline board" in its view settings
    Then widget 1 is titled "Pipeline board"
    And the view of widget 1 is named "Pipeline board"
    And the dashboard layout stores no widget title

  Scenario: The widget picker offers this dashboard's own views but not another dashboard's
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user creates a new "Board" view of "Projects" from the widget picker
    And another dashboard of "Projects" owns a "Calendar" view
    When the user opens the widget picker
    Then the widget picker lists the view of widget 1
    And the widget picker does not list views that belong to another dashboard

  Scenario: Opening a widget's own view shows it as the only tab
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user creates a new "Board" view of "Projects" from the widget picker
    When the user clicks Done
    And the user opens the data source of widget 1
    Then the tab bar shows only the view of widget 1

  Scenario: Duplicating a dashboard tab copies its own widget views and keeps shared ones
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user adds the "Grid" view of "Projects" from the widget picker
    And the user creates a new "Board" view of "Projects" from the widget picker
    When the user duplicates the dashboard tab
    Then the copied dashboard has 2 widgets
    And widget 1 of the copied dashboard shows the "Grid" view of "Projects"
    And widget 2 of the copied dashboard shows a view that belongs to the copied dashboard
    And widget 2 of the copied dashboard is titled "Board"

  Scenario: Duplicating a linked dashboard block keeps its widgets
    Given a document with a linked dashboard of "Projects" showing the "Grid" view and a new "Board" view
    When the user duplicates the dashboard block
    Then the copied dashboard block has 2 widgets
    And the copied block's "Grid" widget shows the "Grid" view of "Projects"
    And the copied block's "Board" widget shows a view that belongs to the copied dashboard

  Scenario: Duplicating a database page points its dashboard at the copy
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And a "Tasks" database with a "Grid" view
    And the user creates a new "Board" view of "Projects" from the widget picker
    And the user adds the "Grid" view of "Tasks" from the widget picker
    When the user duplicates the "Projects" database page from the sidebar
    Then the copied dashboard's "Board" widget shows a view of the copied database
    And the copied dashboard's "Grid" widget still shows the "Grid" view of "Tasks"
    And the copied "Board" view is not a tab of the copied database
