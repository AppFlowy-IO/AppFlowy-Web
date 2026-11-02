@dashboard @dashboard-usecase @cloud @dashboard-template-4
Feature: Training and body log dashboard
  Based on the "Body OS" template (weight trend by week as an average line,
  calories by day, two widgets per row), a Chinese climbing-session tracker
  (sessions by climbing type) and a French fitness progression dashboard.
  An amateur climber logs sessions and weigh-ins, often from a phone right
  after training, and reviews the week on Sunday: training minutes, calories
  per day, sessions by type and the average weight per week.

  # @dashboard-template-4 scopes the steps of dashboard-template-4.steps.ts,
  # shared with life-os.feature and hr-headcount.feature. The desktop twin is
  # usecases/training_log.feature, with the same scenarios.
  #
  # Weigh-ins are taken twice a day (AM and PM) exactly 7 days apart, so the
  # weekly average has two readings per week on any run date. Weeks start on
  # Monday. "day of today - 2" and "week of today - 7" name the chart's
  # bucket of that day (on 2026-10-06: "October 4, 2026" and "Week of Sep 28
  # - Oct 4, 2026"). "prints these values" compares each value as the chart
  # prints it (its tooltip text), so an average reads as the climber sees it
  # ("82.7").
  #
  # The phone scenario shows the owner's dashboard at 390 x 844, which the
  # web treats as a phone (below 768 px): widgets stack in one column, and a
  # tap on a chart first shows its tooltip; a second tap on the same slice
  # opens its rows in a full-height bottom sheet (WP14).

  Background:
    Given a workspace for the "Training log" use case
    And a "Workouts" database with these properties:
      | property | type   | options                                       |
      | Type     | Select | Bouldering, Sport climbing, Running, Strength |
      | Calories | Number |                                               |
      | Minutes  | Number |                                               |
      | Date     | Date   |                                               |
    And "Workouts" has these rows:
      | Name              | Type           | Calories | Minutes | Date      |
      | Gym boulder night | Bouldering     | 520      | 90      | today - 2 |
      | Easy run          | Running        | 310      | 35      | today - 2 |
      | Lead climbing     | Sport climbing | 610      | 120     | today - 1 |
      | Leg day           | Strength       | 450      | 60      | today     |
      | Tempo run         | Running        | 380      | 40      | today     |
      | Hangboard         | Strength       | 150      | 20      | today - 9 |
      | Crag day          | Sport climbing | 1200     | 300     | today - 9 |
    And a "Weigh-ins" database with these properties:
      | property | type   | options |
      | Weight   | Number |         |
      | Logged   | Date   |         |
    And "Weigh-ins" has these rows:
      | Name             | Weight | Logged     |
      | Two weeks ago AM | 82.4   | today - 14 |
      | Two weeks ago PM | 83.0   | today - 14 |
      | Last week AM     | 81.8   | today - 7  |
      | Last week PM     | 82.2   | today - 7  |
      | Today AM         | 81.0   | today      |
      | Today PM         | 81.6   | today      |
    And "Workouts" has these views:
      | view             | layout       | settings                                 |
      | Training minutes | Number chart | sum of Minutes, titled "Minutes trained" |
      | Sessions by type | Donut chart  | count by Type                            |
      | Calories by day  | Bar chart    | sum of Calories by Date per day          |
      | Recent sessions  | Grid         |                                          |
    And "Weigh-ins" has these views:
      | view                   | layout       | settings                             |
      | Lightest weigh-in      | Number chart | min of Weight                        |
      | Average weight by week | Line chart   | average of Weight by Logged per week |
      | Weigh-ins              | Grid         |                                      |
    And the "Training" dashboard on "Workouts" shows:
      | row | widgets                                               |
      | 1   | Training minutes, Lightest weigh-in, Sessions by type |
      | 2   | Calories by day, Average weight by week               |
      | 3   | Recent sessions, Weigh-ins                            |

  Scenario: The Sunday review of the training week
    When I open the "Training" dashboard
    Then the "Training minutes" widget shows the caption "Minutes trained" above the number "665"
    And the "Lightest weigh-in" widget shows the caption "Min of Weight" above the number "81"
    And the "Sessions by type" chart total is "7"
    And the "Calories by day" chart prints these values:
      | label            | value |
      | day of today - 9 | 1,350 |
      | day of today - 2 | 830   |
      | day of today - 1 | 610   |
      | day of today     | 830   |
    And the "Average weight by week" chart prints these values:
      | label              | value |
      | week of today - 14 | 82.7  |
      | week of today - 7  | 82    |
      | week of today      | 81.3  |
    When I click the "Running" segment of the "Sessions by type" chart
    Then the drill-down is titled "Running"
    And the drill-down shows the category chip "Type: Running"
    And the drill-down lists "Easy run, Tempo run"

  Scenario: Logging a session from the phone right after training
    When I open the "Training" dashboard on a 390 by 844 screen
    Then I see every widget stacked in a single column
    When I add a row named "Hill sprints" in the "Recent sessions" widget
    And I change the "Minutes" of "Hill sprints" to "25" in the "Recent sessions" widget
    And I change the "Type" of "Hill sprints" to "Running" in the "Recent sessions" widget
    Then the "Training minutes" widget shows the number "690"
    And the "Sessions by type" chart total is "8"
    When I tap the "Running" slice of the "Sessions by type" chart
    Then the chart tooltip shows "Running"
    When I tap the "Running" slice of the "Sessions by type" chart again
    Then a full-height bottom sheet titled "Running" is open
    And the bottom sheet lists the rows "Easy run, Tempo run, Hill sprints"

  Scenario: Correcting a weigh-in moves the weekly average
    When I open the "Training" dashboard
    And I change the "Weight" of "Today PM" to "80.6" in the "Weigh-ins" widget
    Then the "Lightest weigh-in" widget shows the number "80.6"
    And the "Average weight by week" chart prints these values:
      | label              | value |
      | week of today - 14 | 82.7  |
      | week of today - 7  | 82    |
      | week of today      | 80.8  |

  Scenario: The last three days across workouts and weigh-ins
    When I open the "Training" dashboard
    And I add a global filter on "Date" with the condition "Is on or after" and the value "today - 2", using:
      | property | database  |
      | Logged   | Weigh-ins |
    Then the "Date" global filter chip shows 2 sources
    And the "Date" global filter shows an unsaved dot
    And the "Training minutes" widget shows the number "345"
    And the "Sessions by type" chart total is "5"
    And the "Calories by day" chart prints these values:
      | label            | value |
      | day of today - 2 | 830   |
      | day of today - 1 | 610   |
      | day of today     | 830   |
    And the "Lightest weigh-in" widget shows the number "81"
    And the "Average weight by week" chart prints these values:
      | label         | value |
      | week of today | 81.3  |
    And the "Weigh-ins" widget lists "Today AM, Today PM"
