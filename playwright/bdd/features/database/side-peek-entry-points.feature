Feature: Database side peek entry points

  Every layout opens its rows in the same nonmodal side peek
  (data-peek-mode="side") showing the row that was picked. Mirrors desktop
  SP6 (list, gallery and feed rows) and covers the entry points desktop has
  no hover control for: board cards and keyboard selection, the calendar
  event popover and No Date list, the chart drill-down, timeline bars and
  relation links.

  # Mirror of desktop SP6. A web card click opens the peek directly; the list
  # row additionally exposes a keyboard-only "Open row" control.
  Scenario: List, gallery and feed rows open in the side peek from their cards
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Layouts" with rows "Amber, Birch, Cedar"
    When I open a new List view of the database
    And I open the row "Amber" in the peek from the list view
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop
    When I close the peek with the close button
    And I activate the Open row button of the list row "Birch"
    Then the peek is open in side mode showing "Birch"
    When I close the peek with the close button
    And I open a new Gallery view of the database
    And I open the row "Cedar" in the peek from the gallery view
    Then the peek is open in side mode showing "Cedar"
    When I close the peek with the close button
    And I open a new Feed view of the database
    And I open the row "Amber" in the peek from the feed view
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop

  Scenario: Board cards open the side peek from a click and from Enter on the selected card
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Board" with rows "Amber, Birch, Cedar"
    When I open a new Board view of the database
    And I open the row "Amber" in the peek from the board view
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop
    When I close the peek with the close button
    And I select the board card "Birch" with the arrow keys and press Enter
    Then the peek is open in side mode showing "Birch"

  Scenario: A calendar event expands from its popover into the side peek
    Given I am signed in for side peek testing
    And I have created a calendar named "Peek Calendar" with events "Launch, Review"
    When I open the row "Launch" in the peek from its calendar event
    Then the peek is open in side mode showing "Launch"
    And the peek has no backdrop

  Scenario: A calendar No Date row opens the side peek
    Given I am signed in for side peek testing
    And I have created a calendar named "Peek No Date" with events "Launch"
    And the calendar has an undated row "Backlog"
    When I open the No Date list
    Then the No Date list shows 1 undated row
    When I open the undated row "Backlog" from the No Date list
    Then the peek is open in side mode showing "Backlog"

  # One category keeps bar 1 unambiguous; the empty category is only drawn
  # for rows without an option.
  Scenario: A chart drill-down row opens the side peek and closes the popup
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Chart" with rows "Amber, Birch, Cedar"
    And the row "Amber" has the option "Design" in its "Type" property
    And the row "Birch" has the option "Design" in its "Type" property
    And the row "Cedar" has the option "Design" in its "Type" property
    When I open a new Chart view of the database
    And I open the row "Birch" in the peek from the chart drill-down of bar 1
    Then the peek is open in side mode showing "Birch"
    And the chart drill-down popup is closed

  # Timeline creation is Pro-gated on hosted servers, like the timeline suite.
  Scenario: A timeline bar opens the side peek from a click and from Enter
    Given I am signed in for side peek testing with a Pro subscription
    And I have created a calendar named "Peek Timeline" with events "Design, Build"
    When I open a new Timeline view of the database
    And I click the timeline bar "Build"
    Then the peek is open in side mode showing "Build"
    And the peek has no backdrop
    When I close the peek with the close button
    And I focus the "Design" bar and press Enter
    Then the peek is open in side mode showing "Design"

  # The related database carries a property the source grid lacks, and the
  # peek's prev/next order follows the related database's rows.
  Scenario: A relation link opens the related row in the side peek with its own database
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Projects" with rows "Alpha, Beta, Gamma"
    And the grid has a text property named "Budget"
    When I open the row "Alpha" in the peek from the grid
    And I set the "Budget" text property in the peek to "500"
    And I close the peek with the close button
    Given I have created a grid named "Peek Tasks" with rows "Task one, Task two, Task three"
    And the grid has a relation property named "Project" linked to the database "Peek Projects"
    And the row "Task one" is linked to "Alpha" through its "Project" property
    When I reload the database page
    And I open the row "Task one" in the peek from the grid
    Then the peek is open in side mode showing "Task one"
    When I follow the relation link "Alpha" in the "Project" property of the peek
    Then the peek is open in side mode showing "Alpha"
    And the "Budget" property in the peek shows "500"
    And the peek navigation order is "Alpha, Beta, Gamma"
