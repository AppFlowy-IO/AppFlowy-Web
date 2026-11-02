@dashboard @dashboard-usecase @dashboard-template-1 @cloud
Feature: Customer support desk dashboard
  Based on the "By component" horizontal bar of the Bug Tracker dashboard
  that Notion Agent builds, the multi-select "Top use cases" bar of the
  Ambassador feedback dashboard, and the Triage table of the Notion
  dashboards team's own "Dashboard's Dashboard". The support lead reads the
  queue every morning and saves the urgent tickets as a view for the team;
  agents search the queue, delete spam, focus the page on their tags and try
  filters privately before the lead changes the shared queue in Edit mode.

  # "Created" and "Last edited" are row timestamps set when the rows are
  # seeded, so every ticket falls in the "Today" bucket. These buckets and
  # the "Yesterday" / "Today" filters are run-time dependent on purpose: a
  # run that crosses midnight between seeding and checking can flake.
  #
  # "Feature requests" is 16 characters, longer than the 15 the web chart
  # axis shows before truncating it. The chart value checks read the chart
  # data, not the axis ticks.
  #
  # Widget search: table widgets offer Search in View mode, as in Notion. It
  # narrows only that widget, for this session, and is never saved.

  Background:
    Given a workspace for the "Support desk" use case
    And a "Tickets" database with these properties:
      | property      | type             | options                                 |
      | Status        | Select           | Open, Pending, Solved                   |
      | Tags          | Multi-select     | Billing, Bug, Sign-in, Feature requests |
      | Priority      | Select           | Urgent, High, Normal                    |
      | Refund issued | Checkbox         |                                         |
      | Customer      | Text             |                                         |
      | Created       | Created time     |                                         |
      | Last edited   | Last edited time |                                         |
    And "Tickets" has these rows:
      | Name                             | Status  | Tags             | Priority | Refund issued | Customer          |
      | Charged twice for March          | Open    | Billing          | Urgent   | yes           | dana@northwind.io |
      | Login fails after password reset | Open    | Sign-in          | High     | no            | li@globex.com     |
      | Export to CSV crashes            | Pending | Bug              | High     | no            | sam@initech.com   |
      | Invoice shows wrong VAT          | Open    | Billing, Bug     | Normal   | no            | ana@umbrella.eu   |
      | SSO login loops                  | Open    | Sign-in, Bug     | Urgent   | no            | kai@hooli.com     |
      | Add dark mode to reports         | Pending | Feature requests | Normal   | no            | mo@stark.tools    |
      | Refund for annual plan           | Solved  | Billing          | Normal   | yes           | jo@wayne.co       |
      | 2FA code never arrives           | Solved  | Sign-in          | High     | no            | eve@acme.cloud    |
      | WIN A FREE CRUISE                | Open    |                  | Normal   | no            | promo@spam.biz    |
    And "Tickets" has these views:
      | view            | layout               | settings                                                                         |
      | Urgent          | Number chart         | count, titled "Urgent tickets" where Priority is Urgent and Status is not Solved |
      | Refunds         | Donut chart          | count by Refund issued                                                           |
      | Tickets by day  | Bar chart            | count by Created per relative date                                               |
      | Tickets touched | Bar chart            | count by Last edited per relative date                                           |
      | Open by tag     | Horizontal bar chart | count by Tags where Status is not Solved                                         |
      | Queue           | Grid                 | where Status is not Solved                                                       |
    And the "Support" dashboard on "Tickets" shows:
      | row | widgets                                          |
      | 1   | Urgent, Refunds, Tickets by day, Tickets touched |
      | 2   | Open by tag, Queue                               |

  Scenario: The support lead reads the morning queue and saves the urgent tickets as a view
    When I open the "Support" dashboard
    Then the "Urgent" widget shows the caption "Urgent tickets" above the number "2"
    And the "Open by tag" chart shows these values:
      | label            | value |
      | Billing          | 2     |
      | Bug              | 3     |
      | Sign-in          | 2     |
      | Feature requests | 1     |
      | No Tags          | 1     |
    And the "Refunds" chart total is "9"
    And the "Tickets by day" chart shows these values:
      | label | value |
      | Today | 9     |
    And the "Tickets touched" chart shows these values:
      | label | value |
      | Today | 9     |
    And the "Queue" widget lists "Charged twice for March, Login fails after password reset, Export to CSV crashes, Invoice shows wrong VAT, SSO login loops, Add dark mode to reports, WIN A FREE CRUISE"
    And the "Queue" widget header offers "Filter, Sort, Search, New"
    When I search the "Queue" widget for "login"
    Then the "Queue" widget lists "Login fails after password reset, SSO login loops"
    And the "Urgent" widget shows the number "2"
    And the "Queue" view has 1 saved filters
    When I click the "Checked" segment of the "Refunds" chart
    Then the drill-down lists "Charged twice for March, Refund for annual plan"
    When I close the drill-down
    And I click the number of the "Urgent" widget
    Then the drill-down is titled "Urgent tickets"
    And the drill-down lists "Charged twice for March, SSO login loops"
    When I choose "Save as view…" in the drill-down menu
    Then the view name field shows "Urgent tickets"
    When I save the view as "Urgent queue"
    Then the "Urgent queue" view of "Tickets" is open
    And the "Urgent queue" view is a table listing "Charged twice for March, SSO login loops"
    And the "Urgent queue" view has 2 saved filters
    And the "Urgent queue" view is shown as a tab of "Tickets"

  Scenario: An agent deletes a spam ticket straight from the queue
    When I open the "Support" dashboard
    And I delete the "WIN A FREE CRUISE" row from the "Queue" widget
    Then the "Queue" widget lists "Charged twice for March, Login fails after password reset, Export to CSV crashes, Invoice shows wrong VAT, SSO login loops, Add dark mode to reports"
    And the "Open by tag" chart shows these values:
      | label            | value |
      | Billing          | 2     |
      | Bug              | 3     |
      | Sign-in          | 2     |
      | Feature requests | 1     |
    And the "Tickets by day" chart shows these values:
      | label | value |
      | Today | 8     |
    And the "Tickets touched" chart shows these values:
      | label | value |
      | Today | 8     |
    And the "Refunds" chart total is "8"

  Scenario: A billing agent focuses the page on tags, refunds and recent activity
    When I open the "Support" dashboard
    And I add a global filter on "Tags" with the condition "Contains" and the value "Billing"
    Then the "Open by tag" chart shows these values:
      | label   | value |
      | Billing | 2     |
      | Bug     | 1     |
    And the "Urgent" widget shows the number "1"
    And the "Queue" widget lists "Charged twice for March, Invoice shows wrong VAT"
    And the "Refunds" chart total is "3"
    When I add a global filter on "Refund issued" with the condition "Is checked" and the value ""
    Then the "Refunds" chart total is "2"
    And the "Queue" widget lists "Charged twice for March"
    And the "Open by tag" chart shows these values:
      | label   | value |
      | Billing | 1     |
    When I remove the global filter "Tags"
    And I remove the global filter "Refund issued"
    And I add a global filter on "Created" with the condition "Yesterday" and the value ""
    Then the "Urgent" widget shows no data
    And the "Queue" widget lists nothing
    When I remove the global filter "Created"
    And I add a global filter on "Last edited" with the condition "Today" and the value ""
    Then the "Urgent" widget shows the number "2"
    And the "Refunds" chart total is "9"

  Scenario: Private widget filters in View mode, then a shared queue filter in Edit mode
    When I open the "Support" dashboard
    And I add a "Refund issued" is unchecked filter inside the "Queue" widget
    And I add a "Customer" contains ".com" filter inside the "Queue" widget
    Then the "Queue" widget lists "Login fails after password reset, Export to CSV crashes, SSO login loops"
    When I add a "Priority" is "Urgent" filter inside the "Open by tag" widget
    Then the "Open by tag" chart shows these values:
      | label   | value |
      | Billing | 1     |
      | Bug     | 1     |
      | Sign-in | 1     |
    And the "Queue" widget Filter button shows an unsaved dot
    And the "Open by tag" widget Filter button shows an unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    And the "Queue" view has 1 saved filters
    And the "Open by tag" view has 1 saved filters
    When I reset the dashboard local conditions
    Then the "Queue" widget lists "Charged twice for March, Login fails after password reset, Export to CSV crashes, Invoice shows wrong VAT, SSO login loops, Add dark mode to reports, WIN A FREE CRUISE"
    And the "Open by tag" chart shows these values:
      | label            | value |
      | Billing          | 2     |
      | Bug              | 3     |
      | Sign-in          | 2     |
      | Feature requests | 1     |
      | No Tags          | 1     |
    When I switch the dashboard to Edit mode
    And I add a "Status" is "Open" filter inside the "Queue" widget
    Then no unsaved dot is shown on the dashboard
    And the "Queue" view has 2 saved filters
    When I finish editing the dashboard
    And I reload the dashboard
    Then the "Queue" widget lists "Charged twice for March, Login fails after password reset, Invoice shows wrong VAT, SSO login loops, WIN A FREE CRUISE"
    And no unsaved dot is shown on the dashboard
