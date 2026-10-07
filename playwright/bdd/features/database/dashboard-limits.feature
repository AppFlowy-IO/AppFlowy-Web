@dashboard @cloud @dashboard-limits
Feature: Dashboard limits
  A dashboard holds at most 12 widgets, a row at most 4, and a row is 240 to
  1200 pixels tall in steps of 20. Every way of adding a widget refuses at the
  limit: the control explains itself with the Dashboard is full tooltip, the
  refusal is announced to assistive technology, never shown as a banner, and
  nothing is created. Moving a widget is never an add. A layout another client
  saved over the limit shows its first 12 widgets and keeps the rest in
  storage, so a later edit never drops them. Undo, redo and collaborators
  never take a dashboard past 12 widgets.

  # Same scenarios, word for word, as the desktop dashboard_limits.feature
  # (bdd_widget_test brace syntax on both clients). Seeded widgets are w:1..w:n
  # in reading order, in rows r:1.., every one showing the host Projects Grid.
  # "Saved" reads the stored layout as every client sees it, unknown and
  # hidden entries included; "shows" reads what is rendered.

  Scenario: A full dashboard refuses every add with an announcement and creates no view
    Given a dashboard seeded with rows of {'4, 4, 3, 1'} widgets is open in edit mode
    When the user clicks the add to new row button
    Then the refusal {'Dashboard is full. Delete a view to add a new one.'} was announced
    And no {'New view'} picker is open
    When the user hovers dashboard row {4}
    And the user clicks the add to row button of dashboard row {4}
    Then the refusal {'Dashboard is full. Delete a view to add a new one.'} was announced
    And no {'New view'} picker is open
    When the user opens the menu of dashboard widget {12}
    And the user clicks the dashboard widget menu item {'duplicate'}
    Then the refusal {'Dashboard is full. Delete a view to add a new one.'} was announced
    When the user dismisses the dashboard widget menu
    Then the dashboard has {12} widgets
    And the dashboard created no view
    And the dashboard shows no limit banner

  Scenario: A widget dropped on a full row is refused and the row limit is announced
    Given a dashboard seeded with rows of {'4, 1'} widgets is open in edit mode
    When the user drags dashboard widget {5} onto the left side of dashboard widget {1}
    Then the refusal {'A row holds up to 4 widgets.'} was announced
    And the dashboard row {1} has widget ids {'w:1, w:2, w:3, w:4'}
    And the dashboard row {2} has widget ids {'w:5'}
    And the dashboard shows no limit banner

  Scenario: Moving widgets into new rows is allowed on a full dashboard
    Given a dashboard seeded with rows of {'4, 4, 3, 1'} widgets is open in edit mode
    When the user drags dashboard widget {1} into dashboard row gap {4}
    Then the dashboard has {5} rows
    And the dashboard has {12} widgets
    And the dashboard row {5} has widget ids {'w:1'}
    And the dashboard row {1} has widths {'4, 4, 4'}
    When the user opens the menu of dashboard widget {1}
    And the user chooses {'create-row-below'} in the dashboard widget menu
    Then the dashboard has {6} rows
    And the dashboard has {12} widgets
    And the dashboard row {2} has widget ids {'w:2'}
    And no refusal was announced

  Scenario: Duplicating a widget of a full row puts the copy in a new row below
    Given a dashboard seeded with rows of {'4, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'duplicate'} in the dashboard widget menu
    Then the dashboard has {3} rows
    And the dashboard row {1} has widget ids {'w:1, w:2, w:3, w:4'}
    And the dashboard row {2} holds a copy of dashboard widget {2}
    And the dashboard row {3} has widget ids {'w:5'}

  Scenario: A dashboard saved with more widgets than the limit shows 12 and keeps the rest when it is edited
    Given a dashboard whose saved layout holds rows of {'4, 4, 4, 2'} widgets is open in edit mode
    Then the dashboard shows {12} widgets
    And the saved dashboard layout holds {14} widgets
    And the add to new row button is disabled
    When the user opens the menu of dashboard widget {1}
    And the user chooses {'move-right'} in the dashboard widget menu
    Then the dashboard row {1} has widget ids {'w:2, w:1, w:3, w:4'}
    And the dashboard shows {12} widgets
    And the saved dashboard layout holds {14} widgets
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    Then the dashboard shows {12} widgets
    And dashboard row {4} shows the widget ids {'w:13'}
    And the saved dashboard layout holds {13} widgets

  Scenario: A saved row of more than 4 widgets is shown as rows of at most 4 and keeps every widget when it is edited
    Given a dashboard whose saved layout holds rows of {'6'} widgets is open in edit mode
    Then the dashboard shows rows of {'4, 2'} widgets
    And the saved dashboard layout holds {6} widgets
    When the user opens the menu of dashboard widget {5}
    And the user chooses {'move-right'} in the dashboard widget menu
    Then the dashboard shows rows of {'4, 2'} widgets
    And dashboard row {2} shows the widget ids {'w:6, w:5'}
    And the saved dashboard layout has rows of {'4, 2'} widgets
    And the saved dashboard layout holds {6} widgets

  Scenario: Row heights stop at the limits and keyboard steps snap to 20 pixels
    Given a dashboard seeded with rows of {'2'} widgets is open in edit mode
    When the user drags the height handle of dashboard row {1} by {2000} pixels
    Then the dashboard row {1} is {1200} pixels tall
    When the user focuses the height handle of dashboard row {1}
    And the user presses the Arrow Down key
    Then the dashboard row {1} is {1200} pixels tall
    When the user presses the Arrow Up key
    Then the dashboard row {1} is {1180} pixels tall
    When another client saves a height of {250} for dashboard row {1}
    And the user focuses the height handle of dashboard row {1}
    And the user presses the Arrow Up key
    Then the dashboard row {1} is {240} pixels tall
    When the user presses the Arrow Up key
    Then the dashboard row {1} is {240} pixels tall
    When another client saves a height of {365} for dashboard row {1}
    And the user focuses the height handle of dashboard row {1}
    And the user presses the Arrow Down key
    Then the dashboard row {1} is {380} pixels tall

  Scenario: Undo and redo across the limit switch the add controls off and on
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    Then the add to new row button is disabled
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    Then the dashboard has {11} widgets
    And the add to new row button is enabled
    When the user presses undo on the dashboard
    Then the dashboard has {12} widgets
    And the add to new row button is disabled
    When the user presses redo on the dashboard
    Then the dashboard has {11} widgets
    And the add to new row button is enabled

  Scenario: Undoing a delete after a collaborator filled the dashboard never shows more than 12 widgets
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    And a collaborator adds a widget to the dashboard in a new row
    Then the dashboard has {12} widgets
    When the user presses undo on the dashboard
    Then the dashboard shows at most {12} widgets
    And the saved dashboard layout holds at most {12} widgets
    And the add to new row button is disabled

  Scenario: Two editors adding a widget at the same time end with one dashboard of at most 12 widgets
    Given a dashboard seeded with rows of {'4, 4, 3'} widgets is open in edit mode
    When the user and a collaborator each add a widget at the same time
    Then the user and the collaborator see the same dashboard layout
    And the dashboard shows at most {12} widgets
    And the saved dashboard layout holds at most {12} widgets
    And no widget appears twice in the saved dashboard layout
    And the add to new row button is disabled

  Scenario: A read-only member sees a full dashboard without any add control
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    When a read-only member opens the dashboard
    Then the member sees {12} dashboard widgets
    And the member sees no add, move or resize controls
