@timeline @cloud
Feature: Timeline view interactions
  A Timeline view plots each row's date property as a bar on a horizontally
  infinite canvas, the way Notion's timeline does, and supports the editing
  interactions frappe-gantt offers: move, resize, snap, dependencies and
  progress. Every scenario starts from a fresh cloud calendar with two dated
  rows and a Timeline view added through the view tabs.

  Background:
    Given a cloud calendar with "Design" today and "Build" in 2 days
    And a Timeline view is added from the view menu

  Scenario: Dated rows render as bars under a month header with today marked
    Then the timeline shows bars for "Design" and "Build"
    And the timeline header marks today and draws the today line
    And the timeline title shows the current month
    And the timeline scale reads "Month"
    And the timeline table lists "Design" and "Build"

  Scenario: Changing the scale relabels the header and persists on the view
    When I choose the "Week" timeline scale
    Then the timeline scale reads "Week"
    And the timeline header cells show weekday names
    And the timeline still shows 2 bars
    When I reload the timeline
    Then the timeline scale reads "Week"
    When I choose the "Month" timeline scale
    Then the timeline scale reads "Month"

  Scenario: Steppers, off-screen pills and Today move the viewport
    When I step the timeline later 2 times
    Then the "Design" bar is off screen to the left with a left pill
    When I click the left off-screen pill
    Then the "Design" bar is visible
    When I step the timeline earlier 3 times
    Then the "Design" bar is off screen to the right with a right pill
    When I click the timeline Today button
    Then the "Design" bar is visible
    And the timeline header marks today and draws the today line

  Scenario: Dragging a bar snaps it to whole columns and undo restores it
    When I drag the "Build" bar 2 columns later
    Then the "Build" bar moved 2 columns later
    When I press undo
    Then the "Build" bar is back where it started

  Scenario: A dropped bar stays where it landed while the row data catches up
    When I drag the "Design" bar 9 columns later while sampling its position
    Then the "Design" bar never painted back where it started after landing 9 columns later

  Scenario: The end handle resizes a bar and Escape cancels a drag in progress
    When I drag the end handle of "Design" 2 columns later
    Then the "Design" bar grew by 2 columns
    And the header highlights nothing once the drag ends
    When I start dragging the "Design" bar and press Escape
    Then the "Design" bar is back where it started

  Scenario: Hovering shows the card; table rows select and open
    When I hover the "Design" bar
    Then the timeline hover card shows "Design" with a one day duration
    When I click the table row "Build"
    Then the "Build" row and bar are selected
    When I click the empty canvas of the "Build" row
    Then no timeline row is selected
    When I open the table row "Build"
    Then the row detail for "Build" opens

  Scenario: Undated rows sit in the table until a click dates them, and the table can be hidden
    When I add a new timeline row
    Then the timeline table lists 3 rows and the No Date button reads "(1)"
    When I click the undated row's canvas
    Then the timeline shows 3 bars and no No Date button
    When I hide the timeline table
    Then the timeline table is hidden and 3 bars remain
    When I show the timeline table
    Then the timeline table lists 3 rows

  Scenario: Dependencies draw arrows, dependents follow the dragged bar, and a bar cannot start before its dependency
    Given "Build" depends on "Design" through a relation field
    Then the timeline draws 1 dependency arrow
    When I drag the "Design" bar 2 columns later
    Then the "Build" bar moved 2 columns later
    When I press undo
    Then the "Build" bar is back where it started
    And the "Design" bar is back where it started
    When I drag the "Build" bar 6 columns earlier
    Then the "Build" bar starts where the "Design" bar starts

  Scenario: A progress field renders a fill that the progress handle drags
    Given "Design" has a progress field at 40 percent
    When I drag the end handle of "Design" 3 columns later
    Then the "Design" bar shows 40 percent progress
    And the timeline hover card for "Design" mentions "40% complete"
    When I drag the progress handle of "Design" halfway across the bar
    Then the "Design" bar shows more than 80 percent progress

  Scenario Outline: Every scale renders a labelled header and keeps the bars
    When I choose the "<scale>" timeline scale
    Then the timeline scale reads "<scale>"
    And the timeline header has labels
    And the timeline still shows 2 bars

    Examples:
      | scale   |
      | Hours   |
      | Day     |
      | Week    |
      | Bi-week |
      | Month   |
      | Quarter |
      | Year    |

  Scenario: Redo re-applies an undone move and the right pill scrolls to a far bar
    When I drag the "Build" bar 2 columns later
    And I press undo
    Then the "Build" bar is back where it started
    When I press redo
    Then the "Build" bar moved 2 columns later
    When I drag the "Build" bar 40 columns later
    Then the "Build" bar is off screen to the right with a right pill
    When I click the right off-screen pill
    Then the "Build" bar is visible

  Scenario: The No Date list, keyboard open, and double-clicking a table row
    When I add a new timeline row
    And I open the No Date list
    Then the No Date list shows 1 undated row
    When I close the No Date list
    And I focus the "Design" bar and press Enter
    Then the row detail for "Design" opens
    When I double-click the table row "Build"
    Then the row detail for "Build" opens

  Scenario: Timeline settings switch the plotted date field, the table, and the week start
    Given "Build" also has a "Ship date" field 5 days later
    When I choose "Ship date" as the timeline date field
    Then the "Build" bar sits 5 days after the "Design" bar
    When I toggle the table from the timeline settings
    Then the timeline table is hidden and 2 bars remain
    When I toggle the table from the timeline settings
    Then the timeline table lists 2 rows
    When I choose Monday as the timeline week start
    And I choose the "Quarter" timeline scale
    Then the timeline quarter labels fall on Mondays

  Scenario: The Layout menu converts a view to a timeline and back
    When I switch to the "Calendar" view tab
    And I change the view layout to "Timeline"
    Then the timeline shows bars for "Design" and "Build"
    When I change the view layout to "Calendar"
    Then the calendar view is shown

  Scenario: Removing the plotted date field shows the empty state until another is chosen
    Given "Build" also has a "Ship date" field 5 days later
    When the timeline's date field is deleted from the database
    Then the timeline explains that it has no date property
    When I choose "Ship date" as the timeline date field
    Then the timeline still shows 2 bars

  Scenario: Extending a bar's end pushes its dependents along
    Given "Build" depends on "Design" through a relation field
    When I drag the end handle of "Design" 3 columns later
    Then the "Design" bar grew by 3 columns
    And the "Build" bar moved 3 columns later

  Scenario: The table's hover gutter inserts, duplicates and deletes rows
    When I click the hover "+" of the table row "Design"
    Then the table lists "Design, Untitled, Build" in that order
    When I open the row menu of the table row "Build" and choose "Insert above"
    Then the table lists "Design, Untitled, Untitled, Build" in that order
    When I open the row menu of the table row "Build" and choose "Duplicate"
    Then the table lists "Design, Untitled, Untitled, Build, Build" in that order
    And the timeline shows 3 bars
    When I open the row menu of the last table row and choose "Delete"
    Then the table lists "Design, Untitled, Untitled, Build" in that order
    And the timeline shows 2 bars

  Scenario: Dragging a row's handle reorders the table
    When I drag the table row "Build" above "Design"
    Then the table lists "Build, Design" in that order
    When I press undo
    Then the table lists "Design, Build" in that order
