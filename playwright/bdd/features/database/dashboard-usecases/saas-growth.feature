@dashboard @dashboard-usecase @dashboard-template-1 @cloud
Feature: SaaS growth metrics dashboard
  Based on the line-chart rows of Notion's "Company Dashboard" ("26H1 Project
  progress", "Upcoming hires by month"), the CMO Operating System's
  "Marketing Spend Trend" and the Personal Finance Tracker's "Yearly Savings"
  line. The growth lead logs every new trial account and reads the weekly
  trend lines each Monday, clicking a week to see who signed up. Before a
  board meeting she turns the running total off, switches the signups line
  to relative dates, shows MRR in compact notation and narrows the whole
  page to one week.

  # Week buckets: the trial dates sit exactly 7 days apart, so each offset is
  # its own Monday-to-Sunday week on any run date. A label written as
  # "week of today - 14" resolves to the product's own bucket label
  # ("Week of Sep 14 - Sep 20, 2026") when the step runs.
  #
  # "Trial conversion" is Notion's "Percent checked" of the Converted
  # checkbox: one decimal unless the share is whole ("37.5%", "100%").
  # MRR uses the US dollar format, so the Number card prints "$48,500", and
  # "$48.5K" in compact notation (the currency symbol stays, as in Notion).
  #
  # Run-time dependent on purpose: the "Relative" buckets and the "Last week"
  # filter are computed against today, so a run that crosses midnight between
  # seeding and checking can flake.

  Background:
    Given a workspace for the "SaaS growth" use case
    And a "Trials" database with these properties:
      | property  | type     | options                 |
      | Channel   | Select   | Organic, Paid, Referral |
      | Seats     | Number   |                         |
      | MRR       | Number   | US dollar               |
      | Signed up | Date     |                         |
      | Converted | Checkbox |                         |
    And "Trials" has these rows:
      | Name        | Channel  | Seats | MRR   | Signed up  | Converted |
      | Northwind   | Organic  | 12    | 6000  | today - 21 | yes       |
      | Globex      | Paid     | 5     | 2500  | today - 21 | no        |
      | Initech     | Referral | 20    | 10000 | today - 14 | yes       |
      | Umbrella    | Paid     | 3     | 1500  | today - 14 | no        |
      | Hooli       | Organic  | 8     | 4000  | today - 14 | no        |
      | Stark Tools | Organic  | 15    | 7500  | today - 7  | yes       |
      | Wayne Labs  | Referral | 25    | 12500 | today      | no        |
      | Acme Cloud  | Paid     | 9     | 4500  | today      | no        |
    And "Trials" has these views:
      | view             | layout       | settings                                                |
      | New trials       | Number chart | count, titled "Trials started"                          |
      | MRR              | Number chart | sum of MRR                                              |
      | Conversion       | Number chart | percent checked of Converted, titled "Trial conversion" |
      | Signups per week | Line chart   | count by Signed up per week                             |
      | By channel       | Donut chart  | count by Channel                                        |
      | Seats growth     | Line chart   | sum of Seats by Signed up per week, cumulative          |
      | Recent trials    | Grid         | sorted by Signed up descending                          |
    And the "Growth" dashboard on "Trials" shows:
      | row | widgets                      |
      | 1   | New trials, MRR, Conversion  |
      | 2   | Signups per week, By channel |
      | 3   | Seats growth, Recent trials  |

  Scenario: The growth lead reads Monday's trend lines and drills into one week
    When I open the "Growth" dashboard
    Then the dashboard opens in View mode
    And the "New trials" widget shows the caption "Trials started" above the number "8"
    And the "MRR" widget shows the caption "Sum of MRR" above the number "$48,500"
    And the "Conversion" widget shows the caption "Trial conversion" above the number "37.5%"
    And the "Signups per week" chart shows these values:
      | label              | value |
      | week of today - 21 | 2     |
      | week of today - 14 | 3     |
      | week of today - 7  | 1     |
      | week of today      | 2     |
    And the "Seats growth" chart shows these values:
      | label              | value |
      | week of today - 21 | 17    |
      | week of today - 14 | 48    |
      | week of today - 7  | 63    |
      | week of today      | 97    |
    And the "By channel" chart total is "8"
    When I click the "week of today - 14" point of the "Signups per week" chart
    Then the drill-down shows the row count "3 rows"
    And the drill-down lists "Initech, Umbrella, Hooli"
    When I open "Initech" from the drill-down
    Then "Initech" opens in a side peek

  Scenario: A trial that signs up today moves every tile
    When I open the "Growth" dashboard
    And I add a row named "Soylent" in the "Recent trials" widget
    And I change the "Seats" of "Soylent" to "10" in the "Recent trials" widget
    And I change the "MRR" of "Soylent" to "5000" in the "Recent trials" widget
    And I change the "Converted" of "Soylent" to "checked" in the "Recent trials" widget
    And I open the "Soylent" row from the "Recent trials" widget
    And I set "Signed up" to "today" on the open page
    And I close the row page
    Then the "New trials" widget shows the number "9"
    And the "MRR" widget shows the number "$53,500"
    And the "Conversion" widget shows the number "44.4%"
    And the "Signups per week" chart shows these values:
      | label              | value |
      | week of today - 21 | 2     |
      | week of today - 14 | 3     |
      | week of today - 7  | 1     |
      | week of today      | 3     |
    And the "Seats growth" chart shows these values:
      | label              | value |
      | week of today - 21 | 17    |
      | week of today - 14 | 48    |
      | week of today - 7  | 63    |
      | week of today      | 107   |
    And the "By channel" chart total is "9"

  Scenario: Preparing the board deck: weekly seats, relative signup buckets and compact MRR
    When I open the "Growth" dashboard
    And I switch the dashboard to Edit mode
    And I open the settings of the "Seats growth" widget
    And I turn off "Cumulative" in the chart settings
    Then the "Seats growth" chart shows these values:
      | label              | value |
      | week of today - 21 | 17    |
      | week of today - 14 | 31    |
      | week of today - 7  | 15    |
      | week of today      | 34    |
    When I close the "View settings" panel
    And I open the settings of the "Signups per week" widget
    And I open "Date grouping" in the "X axis" chart settings section
    And I choose "Relative" in the chart settings
    Then the "Signups per week" chart shows these values:
      | label        | value |
      | Last 30 days | 5     |
      | Last 7 days  | 1     |
      | Today        | 2     |
    When I close the "View settings" panel
    And I open the settings of the "MRR" widget
    And I open "Format" in the "Data" chart settings section
    And I choose "Compact" in the chart settings
    Then the "MRR" widget shows the number "$48.5K"
    When I close the "View settings" panel
    And I finish editing the dashboard
    And I reload the dashboard
    Then the "Signups per week" chart shows these values:
      | label        | value |
      | Last 30 days | 5     |
      | Last 7 days  | 1     |
      | Today        | 2     |
    And the "Seats growth" chart shows these values:
      | label              | value |
      | week of today - 21 | 17    |
      | week of today - 14 | 31    |
      | week of today - 7  | 15    |
      | week of today      | 34    |
    And the "MRR" widget shows the number "$48.5K"

  Scenario: The whole page narrowed to last week
    When I open the "Growth" dashboard
    And I add a global filter on "Signed up" with the condition "Last week" and the value ""
    Then the "New trials" widget shows the number "1"
    And the "MRR" widget shows the number "$7,500"
    And the "Conversion" widget shows the number "100%"
    And the "Signups per week" chart shows these values:
      | label             | value |
      | week of today - 7 | 1     |
    And the "Recent trials" widget lists "Stark Tools"
    And the "Signed up" global filter shows an unsaved dot
    When I remove the global filter "Signed up"
    Then the "New trials" widget shows the number "8"
    And no unsaved dot is shown on the dashboard

  # "Is between" compares days, as the desktop (`DateFilterStrategy::DateBetween`)
  # and Notion do: trials signed up on the last day of the window (stored at
  # noon) count.
  Scenario: A custom date window counts both of its days
    When I open the "Growth" dashboard
    And I add a global filter on "Signed up" with the condition "Is between" and the value "today - 21 to today - 14"
    Then the "New trials" widget shows the number "5"
    And the "MRR" widget shows the number "$24,000"
    And the "Conversion" widget shows the number "40%"
    And the "By channel" chart total is "5"
    And the "Seats growth" chart shows these values:
      | label              | value |
      | week of today - 21 | 17    |
      | week of today - 14 | 48    |
    When I remove the global filter "Signed up"
    Then the "New trials" widget shows the number "8"
