@dashboard @dashboard-usecase @cloud @dashboard-template-4
Feature: Personal Life OS "Today" dashboard across four databases
  Based on Ols Notion's gamified "Game Mode" and creator daily hub (habit,
  task, content and journal widgets under one "Date: This day" filter that
  spans four databases) and the Japanese kurashi daily dashboard. A solo
  creator starts every day here: habits in a gallery, the journal as a
  feed, open tasks and today's publishing, all narrowed by one "Day"
  filter. On a Free workspace they first learn that a new dashboard needs
  Pro; the existing one keeps working.

  # @dashboard-template-4 scopes the steps of dashboard-template-4.steps.ts,
  # shared with training-log.feature and hr-headcount.feature. The desktop
  # twin is usecases/life_os.feature, with the same scenarios.
  #
  # The "Today" and "Tomorrow" conditions are computed against the run date
  # on purpose: a run that crosses midnight between seeding and checking can
  # flake.
  #
  # The dashboard lives on "Habits log"; its three other databases load
  # through the dashboard's queue, at most 2 at a time
  # (tokens.json loading.maxConcurrentSources). In View mode a writer's new
  # global filter is saved for everyone with its default condition, and the
  # condition chosen afterwards stays private (the pill's unsaved dot) until
  # "Save for everyone" (WP07).

  Background:
    Given a workspace for the "Life OS" use case
    And a "Habits log" database with these properties:
      | property | type     | options                       |
      | Area     | Select   | Health, Learning, Mindfulness |
      | Done     | Checkbox |                               |
      | Day      | Date     |                               |
      | Points   | Number   |                               |
    And "Habits log" has these rows:
      | Name            | Area        | Done | Day       | Points |
      | Morning run     | Health      | yes  | today     | 10     |
      | Read 20 pages   | Learning    | no   | today     | 5      |
      | Meditate 10 min | Mindfulness | yes  | today     | 5      |
      | Spanish lesson  | Learning    | no   | today     | 3      |
      | Evening walk    | Health      | yes  | today - 1 | 4      |
      | Journal prompt  | Mindfulness | yes  | today - 1 | 2      |
      | Guitar practice | Learning    | no   | today - 1 | 3      |
    And a "Journal" database with these properties:
      | property   | type   | options          |
      | Mood       | Select | Great, Okay, Low |
      | Written on | Date   |                  |
    And "Journal" has these rows:
      | Name                        | Mood  | Written on |
      | Shipped the dashboard video | Great | today      |
      | Rainy and low energy        | Low   | today - 1  |
      | Planning the week           | Okay  | today - 7  |
    And a "Tasks" database with these properties:
      | property | type     | options      |
      | Priority | Select   | High, Normal |
      | Done     | Checkbox |              |
      | Due      | Date     |              |
    And "Tasks" has these rows:
      | Name             | Priority | Done | Due       |
      | Edit episode 12  | High     | no   | today     |
      | Reply to sponsor | High     | yes  | today     |
      | Book dentist     | Normal   | no   | today + 1 |
      | Back up photos   | Normal   | no   | today - 1 |
    And a "Content" database with these properties:
      | property  | type     | options             |
      | Platform  | Select   | YouTube, Newsletter |
      | Published | Checkbox |                     |
      | Publish   | Date     |                     |
    And "Content" has these rows:
      | Name                     | Platform   | Published | Publish   |
      | Episode 12: Life OS tour | YouTube    | no        | today     |
      | Newsletter #48           | Newsletter | yes       | today - 1 |
    And "Habits log" has these views:
      | view           | layout       | settings                                    |
      | Habits done    | Donut chart  | count by Done                               |
      | Points         | Number chart | sum of Points where Done is checked         |
      | Points by area | Bar chart    | sum of Points by Area where Done is checked |
      | Habit cards    | Gallery      |                                             |
    And "Journal" has these views:
      | view    | layout | settings |
      | Journal | Feed   |          |
    And "Tasks" has these views:
      | view       | layout | settings                |
      | Open tasks | List   | where Done is unchecked |
    And "Content" has these views:
      | view       | layout | settings |
      | Publishing | List   |          |
    And the "Today" dashboard on "Habits log" shows:
      | row | widgets                             |
      | 1   | Habits done, Points, Points by area |
      | 2   | Habit cards, Journal                |
      | 3   | Open tasks, Publishing              |

  Scenario: The morning check-in: one "today" filter across habits, journal, tasks and content
    When I open the "Today" dashboard with nothing cached
    Then no more than 2 source databases were loading at the same time
    And the "Points" widget shows the number "21"
    And the "Habits done" chart total is "7"
    And the "Journal" widget shows the posts "Shipped the dashboard video, Rainy and low energy, Planning the week"
    When I add a global filter on "Day" with the condition "Today", using:
      | property   | database |
      | Written on | Journal  |
      | Due        | Tasks    |
      | Publish    | Content  |
    Then the "Day" global filter chip shows 4 sources
    And the "Day" global filter shows an unsaved dot
    And the "Habits done" chart total is "4"
    And the "Points" widget shows the number "15"
    And the "Points by area" chart shows these values:
      | label       | value |
      | Health      | 10    |
      | Mindfulness | 5     |
    And the "Habit cards" widget shows the cards "Morning run, Read 20 pages, Meditate 10 min, Spanish lesson"
    And the "Journal" widget shows the posts "Shipped the dashboard video"
    And the "Open tasks" widget lists "Edit episode 12"
    And the "Publishing" widget lists "Episode 12: Life OS tour"
    When I click "Save for everyone" in the filter bar
    Then I see the toast "Changes saved for everyone." with an "Undo" button
    And no unsaved dot is shown on the dashboard
    And the "Day" global filter pill reads "Day: Today"

  Scenario: Ticking off a habit from its gallery card
    When I open the "Today" dashboard
    And I open the "Read 20 pages" row from the "Habit cards" widget
    And I tick the "Done" checkbox on the open page
    And I close the row page
    Then the "Points" widget shows the number "26"
    And the "Points by area" chart shows these values:
      | label       | value |
      | Health      | 14    |
      | Learning    | 5     |
      | Mindfulness | 7     |
    When I click the "Checked" segment of the "Habits done" chart
    Then the drill-down is titled "Checked"
    And the drill-down shows the category chip "Done: Checked"
    And the drill-down lists "Morning run, Read 20 pages, Meditate 10 min, Evening walk, Journal prompt"

  Scenario: Evening planning: a private look at tomorrow, then back to today
    Given the "Today" dashboard has a saved "Day" global filter set to "Today", using:
      | property   | database |
      | Written on | Journal  |
      | Due        | Tasks    |
      | Publish    | Content  |
    When I open the "Today" dashboard
    Then the "Points" widget shows the number "15"
    When I switch the "Day" global filter to "Tomorrow"
    Then the "Day" global filter shows an unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    And the "Points" widget shows no data
    And the "Habits done" chart shows no data
    And the "Journal" widget shows no posts
    And the "Open tasks" widget lists "Book dentist"
    And the "Publishing" widget lists nothing
    When I click "Reset" in the filter bar
    Then no unsaved dot is shown on the dashboard
    And the "Day" global filter pill reads "Day: Today"
    And the "Points" widget shows the number "15"
    And the "Open tasks" widget lists "Edit episode 12"

  Scenario: A counter added to the top row splits the row equally
    When I open the "Today" dashboard
    And I switch the dashboard to Edit mode
    And I add a widget with the add button of dashboard row 1
    Then the new widget shows the number "7" with the caption "Count all"
    And dashboard row 1 has widths "3, 3, 3, 3"
    When I close the "New view" picker
    And I finish editing the dashboard
    Then the new widget's view is not a tab of "Habits log"

  # How the Free plan is set (E18): the Background grants Pro twice, on the
  # server (grantWorkspaceProSubscription inserts an active
  # af_workspace_subscription row through APPFLOWY_TEST_POSTGRES_CONTAINER,
  # which CI provides) and in the browser (mockProSubscription answers the
  # billing endpoints with "pro"). The first step undoes both: it makes the
  # workspace's subscriptions inactive and routes the two billing endpoints
  # to answer no active plan, then reloads so the app reads the plan again.
  # A development build (the Vite dev server) skips the plan check
  # (isDevelopmentOrTestEnvironment), so the scenario is skipped there; CI
  # runs a production build.
  @billing
  Scenario: On a Free workspace a new dashboard asks for Pro, the existing one keeps working
    Given the workspace is on the Free plan
    When I try to add a dashboard to "Tasks" from the view tab menu
    Then I am told that "Creating a Dashboard view requires a Pro workspace."
    And "Tasks" has no dashboard view
    When I open the "Today" dashboard
    Then the "Points" widget shows the number "21"
    And the "Habits done" chart total is "7"
