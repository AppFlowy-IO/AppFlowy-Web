@dashboard @cloud
Feature: Dashboard global filter picker and pills
  The toolbar filter button opens a "Filter by…" menu that lists properties
  by source. Picking one creates a filter for that one source and opens its
  pill with the value focused. "Filter multiple sources" builds one filter
  across same-type properties. Select options match across sources by name.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
      | 2   | Notes Grid    |

  Scenario: Picking a property filters only its own source and focuses the value
    When I open the dashboard filter menu
    Then the filter menu search box is focused
    And the filter menu groups properties under "Projects" with "1 view", "Tasks" with "1 view" and "Notes" with "1 view"
    When I pick the "Status" property of "Projects" in the filter menu
    Then the "Status" global filter pill is open with its value focused
    And the "Status" global filter pill has no source count badge
    And the saved "Status" filter targets only "Status" in "Projects"
    When I select "Doing" in the open global filter
    And I close the global filter editor
    Then the "Status" global filter pill reads "Status: Doing"
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"

  Scenario: The filter menu search ignores case and accents
    When I open the dashboard filter menu
    And I search the filter menu for "DÉAD"
    Then the filter menu lists only "Deadline" in "Tasks"
    When I search the filter menu for "zzz"
    Then the filter menu says "No results"

  Scenario: Each source shows five properties before a more row
    When I open the dashboard filter menu
    Then the "Projects" group of the filter menu shows 5 properties and "1 more"
    When I expand the "Projects" group of the filter menu
    Then the "Projects" group of the filter menu shows 6 properties

  Scenario: A dashboard with one source lists its properties without groups
    Given the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    When I open the dashboard filter menu
    Then the filter menu lists the properties of "Projects" without group headers
    And the filter menu does not offer "Filter multiple sources"

  Scenario: Filter multiple sources builds one filter across same-type properties
    When I open the dashboard filter menu
    And I choose "Filter multiple sources" in the filter menu
    Then the filter menu explains "Create a filter that applies across properties from multiple sources"
    When I click "Add to filter" in the filter menu
    And I pick the "Status" property of "Projects" in the filter menu
    Then the multiple sources builder lists "Status" from "Projects"
    When I choose "Add another" in the multiple sources builder
    Then the filter menu only offers "Single select" properties from "Tasks"
    When I pick the "Stage" property of "Tasks" in the filter menu
    And I click Done in the multiple sources builder
    Then the "Status" global filter pill shows a source count badge of 2
    And the saved "Status" filter targets "Status" in "Projects" and "Stage" in "Tasks"

  Scenario: Select options with the same name match across sources
    Given the dashboard is in Edit mode
    And the dashboard has a saved "Region" filter with no value mapped to "Region" in "Projects" and "Area" in "Tasks"
    When I open the "Region" global filter
    Then the open global filter offers the options "Europe, Asia, Africa"
    When I select "Europe" in the open global filter
    And I close the global filter editor
    Then the "Region" global filter pill reads "Region: Europe"
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows the rows "Write launch plan"
    And the saved "Region" filter remembers the option names "Europe"

  Scenario: Pills omit the default operator and turn grey without a value
    Given the dashboard is in Edit mode
    And the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects"
    And the dashboard has a saved "Due" filter with no value mapped to "Due" in "Projects"
    Then the "Status" global filter pill reads "Status: Doing"
    And the "Due" global filter pill reads "Due" and looks empty
    When I open the "Status" global filter
    And I choose the "Is not" condition in the open global filter
    And I close the global filter editor
    Then the "Status" global filter pill reads "Status: Is not Doing"

  Scenario: A relative date filter follows today
    Given the dashboard is in Edit mode
    And the dashboard has a saved "Due" filter with no value mapped to "Due" in "Projects"
    When I open the "Due" global filter
    And I choose the "Is relative to today" condition in the open global filter
    And I set the relative date to "Past" 7 "days" in the open global filter
    Then the open global filter says "Filter will update with the current date"
    When I close the global filter editor
    Then the "Due" global filter pill reads "Due: Past 7 days"
    And the "Projects Grid" widget shows the rows "Website launch, API cleanup"
    And the saved "Due" filter is relative to today with "past", 7 and "day"
    When I open the "Due" global filter
    And I set the relative date to "Next" 7 "days" in the open global filter
    And I close the global filter editor
    Then the "Projects Grid" widget shows the rows "Website launch"

  Scenario: A widget filter can be relative to today
    When I add a "Deadline" is relative to today "Past" 1 "day" filter inside the "Tasks Grid" widget
    Then the "Tasks Grid" widget shows the rows "Write launch plan, Ship"

  Scenario: The filter bar only appears when there are filters
    Given the dashboard is in Edit mode
    Then the dashboard does not show the global filter bar
    When I open the dashboard filter menu
    And I pick the "Urgent" property of "Projects" in the filter menu
    And I close the global filter editor
    Then the dashboard shows the global filter bar with a "+ Filter" button
    When I delete the "Urgent" global filter
    Then the dashboard does not show the global filter bar

  Scenario: The toolbar filter icon shows an active filter without a count
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    Then the dashboard filter button is highlighted without a count badge
