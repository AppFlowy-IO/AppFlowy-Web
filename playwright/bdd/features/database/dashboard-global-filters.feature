@dashboard @cloud
Feature: Dashboard global filters
  "Filter multiple sources" adds dashboard-level filters. Each filter has one
  property type and maps it to one property per source database; it is
  AND-ed with every mapped widget's own view filters and leaves widgets whose
  database has no mapping untouched.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
      | 2   | Notes Grid    |

  Scenario: A Select filter mapped to two sources filters both widgets
    When I add a "Select" global filter mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And I select "Doing" in the open global filter
    And I close the global filter editor
    Then the "Status" global filter chip shows 2 sources
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows the rows "Write launch plan"
    And the "Notes Grid" widget shows the rows "Idea board, Reading list"
    And the saved "Status" filter targets "Status" in "Projects" and "Stage" in "Tasks"

  Scenario: A Checkbox filter keeps checked rows in every mapped source
    When I add a "Checkbox" global filter mapped to "Urgent" in "Projects" and "Blocked" in "Tasks"
    And I choose the "Is checked" condition in the open global filter
    And I close the global filter editor
    Then the "Urgent" global filter chip shows 2 sources
    And the "Projects Grid" widget shows the rows "Website launch, API cleanup"
    And the "Tasks Grid" widget shows the rows "Ship"
    And the "Notes Grid" widget shows the rows "Idea board, Reading list"

  Scenario: A Text filter matches titles across sources
    When I add a "Text" global filter mapped to "Name" in "Projects" and "Name" in "Tasks"
    And I type "launch" into the open global filter
    And I close the global filter editor
    Then the "Name" global filter chip shows 2 sources
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows the rows "Write launch plan"
    And the "Notes Grid" widget shows the rows "Idea board, Reading list"

  Scenario: A Date filter keeps rows dated today or later
    When I add a "Date" global filter mapped to "Due" in "Projects" and "Deadline" in "Tasks"
    And I close the global filter editor
    And the saved "Due" filter keeps dates on or after today
    Then the "Due" global filter chip shows 2 sources
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app"
    And the "Tasks Grid" widget shows the rows "Write launch plan, Review"
    And the "Notes Grid" widget shows the rows "Idea board, Reading list"

  Scenario: Multiple global filters are AND-ed
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And the dashboard has a saved checked "Flag" filter mapped to "Urgent" in "Projects" and "Blocked" in "Tasks"
    Then the dashboard shows 2 global filter chips
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows no rows
    And the "Notes Grid" widget shows the rows "Idea board, Reading list"

  Scenario: Removing a source stops filtering that widget
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I open the "Status" global filter
    And I remove the "Tasks" source from the open global filter
    And I close the global filter editor
    Then the "Status" global filter chip shows 1 source
    And the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"
    And the "Projects Grid" widget shows the rows "Website launch"

  Scenario: Deleting a global filter restores every widget
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I open the "Status" global filter
    And I delete the open global filter
    Then the dashboard shows 0 global filter chips
    And the saved dashboard has no global filters
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    And the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"

  Scenario: A chart widget recomputes under a global filter
    Given "Projects" also has a "Chart" view
    And I open the dashboard again
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget draws 3 bars
    When the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    Then the "Projects Chart" widget draws 1 bar
    When I open the "Status" global filter
    And I delete the open global filter
    Then the "Projects Chart" widget draws 3 bars

  Scenario: A board widget regroups its cards under a global filter
    Given "Projects" also has a "Board" view
    And I open the dashboard again
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Board |
    Then the "Projects Board" widget shows 3 cards
    When the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    Then the "Projects Board" widget shows 1 card
    And the "Doing" column of the "Projects Board" widget shows 1 card
    And the "Todo" column of the "Projects Board" widget shows 0 cards
