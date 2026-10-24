@dashboard @cloud
Feature: Unsaved dashboard changes
  Changes a viewer makes in View mode to global filter values and to widget
  filters and sorts stay on this device until someone with write access saves
  them for everyone. An orange dot marks what differs from the saved dashboard.

  Background:
    Given the "Projects" dashboard shows "Projects Grid" and "Tasks Grid" in one row
    And the dashboard is in View mode

  Scenario: A global filter change marks its pill and the toolbar and survives a reload
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I also select "Done" in the "Status" global filter
    Then the "Status" global filter shows an unsaved dot
    And the dashboard filter button shows an unsaved dot
    And the dashboard filter button shows no count
    And the filter bar shows "Reset" and "Save for everyone"
    And the saved "Status" filter still matches only "Doing"
    When I reload the dashboard
    Then the "Projects Grid" widget shows the rows "Website launch, API cleanup"
    And the "Status" global filter shows an unsaved dot

  Scenario: A widget sort marks only that widget's Sort button and survives a reload
    When I sort the "Tasks Grid" widget by "Points" "descending"
    Then the "Tasks Grid" widget Sort button shows an unsaved dot
    And the "Tasks Grid" widget Filter button shows no unsaved dot
    And the dashboard filter button shows no unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    When I reload the dashboard
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the "Tasks Grid" widget Sort button shows an unsaved dot
    And the "Tasks Grid" view has 0 saved sorts

  Scenario: Changing a value back to the saved one clears the dot
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I also select "Done" in the "Status" global filter
    And I deselect "Done" in the "Status" global filter
    Then no unsaved dot is shown on the dashboard
    And the filter bar shows no "Reset" button

  Scenario: Reset in a widget's popover discards only that widget's changes
    When I add a "Status" is "Done" filter inside the "Projects Grid" widget
    And I sort the "Tasks Grid" widget by "Points" "descending"
    And I click "Reset" in the "Projects Grid" widget filters popover
    Then the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    And the "Projects Grid" widget Filter button shows no unsaved dot
    And the "Tasks Grid" widget Sort button shows an unsaved dot

  Scenario: Save for everyone in a widget's popover saves only that widget and can be undone from the toast
    When I add a "Status" is "Done" filter inside the "Projects Grid" widget
    And I sort the "Tasks Grid" widget by "Points" "descending"
    And I click "Save for everyone" in the "Projects Grid" widget filters popover
    Then I see the toast "Changes saved for everyone." with an "Undo" button
    And the "Projects Grid" view has 1 saved filters
    And the "Tasks Grid" view has 0 saved sorts
    And the "Tasks Grid" widget Sort button shows an unsaved dot
    When I click "Undo" in the toast
    Then the "Projects Grid" view has 0 saved filters
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    And the "Tasks Grid" widget Sort button shows an unsaved dot

  Scenario: Save for everyone in the filter bar saves every change as one step
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I also select "Done" in the "Status" global filter
    And I sort the "Tasks Grid" widget by "Points" "descending"
    And I click "Save for everyone" in the filter bar
    Then I see the toast "Changes saved for everyone." with an "Undo" button
    And no unsaved dot is shown on the dashboard
    And the filter bar shows no "Save for everyone" button
    And the saved "Status" filter matches "Doing, Done"
    And the "Tasks Grid" view has a saved "descending" sort by "Points"
    When I click "Undo" in the toast
    Then the saved "Status" filter matches "Doing"
    And the "Tasks Grid" view has 0 saved sorts

  Scenario: Reset all changes from the Save menu discards everything on this device
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I also select "Done" in the "Status" global filter
    And I sort the "Tasks Grid" widget by "Points" "descending"
    And I choose "Reset all changes" from the "Save for everyone" menu
    Then no unsaved dot is shown on the dashboard
    And the filter bar shows no "Reset" button
    When I reload the dashboard
    Then no unsaved dot is shown on the dashboard
    And the "Tasks Grid" widget shows rows in order "Write launch plan"

  Scenario: Edit mode saves changes directly and shows no unsaved dots
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I click the dashboard Edit button
    And I also select "Done" in the "Status" global filter
    Then no unsaved dot is shown on the dashboard
    And the filter bar shows no "Reset" button
    And the saved "Status" filter matches "Doing, Done"

  Scenario: Private changes are set aside in Edit mode and come back after Done
    When I sort the "Tasks Grid" widget by "Points" "descending"
    And I click the dashboard Edit button
    Then the "Tasks Grid" widget shows rows in order "Write launch plan, Review, Ship"
    And no unsaved dot is shown on the dashboard
    When I click the dashboard Done button
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the "Tasks Grid" widget Sort button shows an unsaved dot

  Scenario: Unreadable saved changes on this device are ignored
    Given this device holds unreadable unsaved changes for the dashboard
    When I reload the dashboard
    Then no unsaved dot is shown on the dashboard
    And the "Tasks Grid" widget shows rows in order "Write launch plan, Review, Ship"

  Scenario: A private value of a deleted global filter is dropped
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I also select "Done" in the "Status" global filter
    And I click the dashboard Edit button
    And I delete the "Status" global filter
    And I click the dashboard Done button
    And I reload the dashboard
    Then no unsaved dot is shown on the dashboard
    And the filter bar shows no "Reset" button

  Scenario: A widget footer total follows private filters without changing the shared total
    Given the "Tasks Grid" view calculates the sum of "Points"
    When I add a "Stage" is "Done" filter inside the "Tasks Grid" widget
    Then the "Tasks Grid" widget footer shows the "Points" sum "4"
    And the shared "Points" sum of the "Tasks Grid" view is still "7"

  Scenario: A row added in a View-mode widget is prefilled from private and global filters
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I add a "Blocked" checkbox filter inside the "Tasks Grid" widget
    And I add a row named "Draft" in the "Tasks Grid" widget
    Then the "Tasks Grid" widget shows the rows "Draft"
    And the "Draft" row of "Tasks" has "Stage" set to "Doing" and "Blocked" checked
    And the "Tasks Grid" view has 0 saved filters

  # Cloud: two accounts (desktop: dashboard_unsaved_changes_cloud.feature)
  Scenario: A read-only member keeps private changes after a reload and can only reset them
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And a workspace member with "read-only" access to the dashboard space
    When the member opens the dashboard
    And the member also selects "Done" in the "Status" global filter
    Then the member sees an unsaved dot on the "Status" global filter
    And the member sees "Reset" but no "Save for everyone" in the filter bar
    When the member reloads the dashboard
    Then the member sees an unsaved dot on the "Status" global filter
    And the saved "Status" filter still matches only "Doing"

  Scenario: A read-only member sees the shared footer total while the owner filters a widget
    Given the "Tasks Grid" view calculates the sum of "Points"
    And a workspace member with "read-only" access to the dashboard space
    When I add a "Stage" is "Done" filter inside the "Tasks Grid" widget
    Then the "Tasks Grid" widget footer shows the "Points" sum "4"
    When the member opens the "Tasks" grid
    Then the member sees the "Points" sum "7" in the grid footer
