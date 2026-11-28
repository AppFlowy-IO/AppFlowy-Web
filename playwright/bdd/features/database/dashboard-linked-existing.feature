@dashboard @cloud
Feature: Link an existing dashboard into a document
  `/Linked Dashboard` lists each database's dashboards beneath it. Picking a
  dashboard gives the document its own dashboard that starts with a copy of
  the picked one: the same widgets, arrangement and global filters. The
  widgets show the same views and rows; widget views the dashboard owns are
  copied; arranging either dashboard afterwards leaves the other unchanged.
  Picking the database itself still starts an empty dashboard.

  Scenario: A linked dashboard starts with a copy of the picked dashboard's widgets
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
    And I am editing a new document in the fixture workspace
    When I open the linked dashboard picker and search for "Projects"
    Then the picker lists the dashboard of "Projects" under the database
    When I pick the dashboard of "Projects" in the picker
    Then the document's dashboard shows the widgets "Projects Grid, Tasks Grid"
    And the document's dashboard is in View mode
    When I reload the document
    Then the document's dashboard shows the widgets "Projects Grid, Tasks Grid"
    When I delete widget 2 of the document's dashboard
    Then the document's dashboard shows the widgets "Projects Grid"
    And the "Projects" dashboard still shows the widgets "Projects Grid, Tasks Grid"

  Scenario: Picking the database of an existing dashboard still starts an empty dashboard
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    And I am editing a new document in the fixture workspace
    When I open the linked dashboard picker and search for "Projects"
    And I pick the "Projects" database in the picker
    Then the document contains a dashboard block titled "View of Projects"
    And the document's dashboard is empty in Edit mode

  Scenario: A dashboard made with /dashboard in another document can be linked
    Given the dashboard fixture workspace is ready
    And I am editing a new document in the fixture workspace
    And the document has a new dashboard from the slash menu showing the "Projects Grid" widget
    And I am editing a new document in the fixture workspace
    When I open the linked dashboard picker and search for "New Database"
    Then the picker lists that dashboard under "New Database"
    When I pick that dashboard in the picker
    Then the document's dashboard shows the widgets "Projects Grid"
    And the document's dashboard is in View mode

  Scenario: Linking an existing dashboard copies the views its widgets own
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And the user adds the "Grid" view of "Projects" from the widget picker
    And the user creates a new "Board" view of "Projects" from the widget picker
    When the user links the dashboard of "Projects" in a new document
    Then the copied dashboard has 2 widgets
    And widget 1 of the copied dashboard shows the "Grid" view of "Projects"
    And widget 2 of the copied dashboard shows a view that belongs to the copied dashboard
    And widget 2 of the copied dashboard is titled "Board"
