@dashboard @cloud @dashboard-limits
Feature: Dashboard limits
  Dashboard widget counts and row sizes are unrestricted. Rows retain all
  widgets while the display wraps to fit the available width. Height bounds,
  permissions, identity preservation and undo still apply.

  # Same scenarios, word for word, as the desktop dashboard_limits.feature
  # (bdd_widget_test brace syntax on both clients). Seeded widgets are w:1..w:n
  # in reading order, in rows r:1.., every one showing the host Projects Grid.
  # "Saved" reads the stored layout as every client sees it, unknown and
  # hidden entries included; "shows" reads what is rendered.

  Scenario: A dashboard above twelve widgets still offers add and duplicate
    Given a dashboard seeded with rows of {'4, 4, 3, 1'} widgets is open in edit mode
    Then the add to new row button is enabled
    When the user clicks the add to new row button
    And the user closes the {'New view'} picker
    Then the dashboard has {13} widgets
    When the user hovers dashboard row {4}
    And the user clicks the add to row button of dashboard row {4}
    And the user closes the {'New view'} picker
    Then the dashboard has {14} widgets
    When the user opens the menu of dashboard widget {1}
    And the user chooses {'duplicate'} in the dashboard widget menu
    Then the dashboard has {15} widgets
    And the add to new row button is enabled
    And no refusal was announced

  Scenario: A widget can join a row that already holds four widgets
    Given a dashboard seeded with rows of {'4, 1'} widgets is open in edit mode
    When the user drags dashboard widget {5} onto the left side of dashboard widget {1}
    Then the dashboard has {1} rows
    And the dashboard row {1} has widget ids {'w:5, w:1, w:2, w:3, w:4'}
    And the dashboard row {1} has widths {'3, 3, 2, 2, 2'}
    And no refusal was announced

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

  Scenario: Duplicating a widget keeps the copy next to its source in a row of four
    Given a dashboard seeded with rows of {'4, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'duplicate'} in the dashboard widget menu
    Then the dashboard has {2} rows
    And the dashboard has {6} widgets
    And the dashboard row {1} has widths {'3, 3, 2, 2, 2'}
    And the dashboard row {2} has widget ids {'w:5'}

  Scenario: All fourteen saved widgets remain visible and editable
    Given a dashboard whose saved layout holds rows of {'4, 4, 4, 2'} widgets is open in edit mode
    Then the dashboard shows {14} widgets
    And the saved dashboard layout holds {14} widgets
    And the add to new row button is enabled
    When the user opens the menu of dashboard widget {1}
    And the user chooses {'move-right'} in the dashboard widget menu
    Then the dashboard row {1} has widget ids {'w:2, w:1, w:3, w:4'}
    And the dashboard shows {14} widgets
    And the saved dashboard layout holds {14} widgets
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    Then the dashboard shows {13} widgets
    And dashboard row {4} shows the widget ids {'w:13, w:14'}
    And the saved dashboard layout holds {13} widgets

  Scenario: A saved six-widget row retains its identity and every widget when edited
    Given a dashboard whose saved layout holds rows of {'6'} widgets is open in edit mode
    Then the dashboard shows rows of {'6'} widgets
    And the saved dashboard layout holds {6} widgets
    When the user opens the menu of dashboard widget {5}
    And the user chooses {'move-right'} in the dashboard widget menu
    Then the dashboard shows rows of {'6'} widgets
    And dashboard row {1} shows the widget ids {'w:1, w:2, w:3, w:4, w:6, w:5'}
    And the saved dashboard layout has rows of {'6'} widgets
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

  Scenario: Undo and redo preserve widgets while add controls stay enabled
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    Then the add to new row button is enabled
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    Then the dashboard has {11} widgets
    And the add to new row button is enabled
    When the user presses undo on the dashboard
    Then the dashboard has {12} widgets
    And the add to new row button is enabled
    When the user presses redo on the dashboard
    Then the dashboard has {11} widgets
    And the add to new row button is enabled

  Scenario: Undoing a delete after a collaborator edit preserves a complete layout
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {12}
    And the user chooses {'delete'} in the dashboard widget menu
    And a collaborator adds a widget to the dashboard in a new row
    Then the dashboard has {12} widgets
    When the user presses undo on the dashboard
    Then the dashboard shows at most {12} widgets
    And the saved dashboard layout holds at most {12} widgets
    And the add to new row button is enabled

  Scenario: Two editors adding beyond twelve converge on a complete layout
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    When the user and a collaborator each add a widget at the same time
    Then the user and the collaborator see the same dashboard layout
    And the dashboard shows {13} widgets
    And the saved dashboard layout holds {13} widgets
    And no widget appears twice in the saved dashboard layout
    And the add to new row button is enabled

  Scenario: A read-only member sees a full dashboard without any add control
    Given a dashboard seeded with rows of {'4, 4, 4'} widgets is open in edit mode
    When a read-only member opens the dashboard
    Then the member sees {12} dashboard widgets
    And the member sees no add, move or resize controls
