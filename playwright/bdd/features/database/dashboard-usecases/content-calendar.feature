@dashboard @dashboard-usecase @dashboard-template-2 @cloud @content-calendar
Feature: Editorial content calendar dashboard
  Based on the French "Calendrier éditorial" dashboard (idea, in-progress
  and published counters, posts per month by status, topic split) and the
  Japanese SNS dashboard (progress board, ideas list, post calendar, posts
  this month, platform share donut), plus Notion's "Social media calendar"
  weekly bar. The content marketer plans on the calendar widget: she opens
  posts from it, drags them to another day, schedules ideas, keeps a list of
  one platform's posts, plans a campaign privately, and adds new views
  straight from the widget picker until the dashboard is full.

  # Publish dates sit exactly 7 days apart, so each is its own week on any
  # run date. "week of today + 7" is resolved to the label the chart prints
  # for that week ("Week of Mar 9 - Mar 15, 2026"). Calendar steps name a day
  # ("today", "today + 7") and step the widget to a month that shows that day
  # before they look, because a month grid does not always show next week.
  # A drag stays inside one month grid: tomorrow is always on today's grid.

  Background:
    Given a workspace for the "Content calendar" use case
    And a "Posts" database with these properties:
      | property   | type   | options                              |
      | Status     | Select | Idea, Drafting, Scheduled, Published |
      | Platform   | Select | Instagram, LinkedIn, Blog, YouTube   |
      | Topic      | Select | Product, Customer story, Tips        |
      | Owner      | Select | Zoe, Ravi                            |
      | Publish on | Date   |                                      |
    And "Posts" has these rows:
      | Name                        | Status    | Platform  | Topic          | Owner | Publish on |
      | Spring feature teaser       | Scheduled | Instagram | Product        | Zoe   | today + 7  |
      | Customer story: Hooli       | Scheduled | Blog      | Customer story | Ravi  | today      |
      | 5 tips for weekly planning  | Published | LinkedIn  | Tips           | Zoe   | today - 7  |
      | Behind the scenes reel      | Published | Instagram | Product        | Zoe   | today - 7  |
      | Launch webinar recording    | Drafting  | YouTube   | Product        | Ravi  | today + 21 |
      | Keyboard shortcuts carousel | Drafting  | Instagram | Tips           | Zoe   | today + 14 |
      | Why we built dashboards     | Published | Blog      | Product        | Ravi  | today - 14 |
      | Meme about Mondays          | Idea      | Instagram |                | Zoe   |            |
      | Podcast guest pitch         | Idea      |           | Customer story | Ravi  |            |
    And "Posts" has these views:
      | view           | layout       | settings                                                           |
      | Published      | Number chart | count where Status is Published                                    |
      | Platform share | Donut chart  | count by Platform                                                  |
      | Posts per week | Bar chart    | count by Publish on per week                                       |
      | Calendar       | Calendar     | by Publish on                                                      |
      | Ideas          | List         | where Publish on is empty                                          |
      | Up next        | List         | sorted by Publish on ascending where Status is Scheduled, Drafting |
    And the "Editorial" dashboard on "Posts" shows:
      | row | widgets                                   |
      | 1   | Published, Platform share, Posts per week |
      | 2   | Calendar, Ideas                           |
      | 3   | Up next                                   |

  Scenario: Monday planning from the calendar, then a list of every Instagram post
    When I open the "Editorial" dashboard
    Then the "Published" widget shows the number "3"
    And the "Platform share" chart total is "9"
    And the "Posts per week" chart shows these values:
      | label              | value |
      | week of today - 14 | 1     |
      | week of today - 7  | 2     |
      | week of today      | 1     |
      | week of today + 7  | 1     |
      | week of today + 14 | 1     |
      | week of today + 21 | 1     |
      | No Publish on      | 2     |
    And the "Calendar" widget shows "Customer story: Hooli" on "today"
    And the "Ideas" widget lists "Meme about Mondays, Podcast guest pitch"
    And the "Up next" widget lists in order "Customer story: Hooli, Spring feature teaser, Keyboard shortcuts carousel, Launch webinar recording"
    When I open the "Customer story: Hooli" event from the "Calendar" widget
    And I set "Status" to "Published" on the open page
    And I close the row page
    Then the "Published" widget shows the number "4"
    And the "Up next" widget lists in order "Spring feature teaser, Keyboard shortcuts carousel, Launch webinar recording"
    # A slice opens a filtered table of its posts, which can be kept as a view.
    When I click the "Instagram" segment of the "Platform share" chart
    Then the drill-down shows the row count "4 rows"
    And the drill-down lists "Spring feature teaser, Behind the scenes reel, Keyboard shortcuts carousel, Meme about Mondays"
    When I choose "Save as view…" in the drill-down menu
    And I save the view as "Instagram posts"
    Then the "Instagram posts" view of "Posts" is open
    And the "Instagram posts" view is a table listing "Spring feature teaser, Behind the scenes reel, Keyboard shortcuts carousel, Meme about Mondays"
    And the "Instagram posts" view is shown as a tab of "Posts"

  Scenario: Rescheduling on the calendar and scheduling an idea
    When I open the "Editorial" dashboard
    And I drag the "Customer story: Hooli" event to "today + 1" in the "Calendar" widget
    Then the "Calendar" widget shows "Customer story: Hooli" on "today + 1"
    And the "Calendar" widget shows nothing on "today"
    And the "Publish on" date of "Customer story: Hooli" in "Posts" is "today + 1"
    And the "Up next" widget lists in order "Customer story: Hooli, Spring feature teaser, Keyboard shortcuts carousel, Launch webinar recording"
    When I open the "Meme about Mondays" row from the "Ideas" widget
    And I set "Publish on" to "today + 7" on the open page
    And I close the row page
    Then the "Ideas" widget lists "Podcast guest pitch"
    And the "Calendar" widget shows "Meme about Mondays" on "today + 7"
    And the "Calendar" widget shows "Spring feature teaser" on "today + 7"
    And the "Publish on" date of "Meme about Mondays" in "Posts" is "today + 7"

  Scenario: Planning an Instagram campaign privately, then one owner and one gap for everyone
    When I open the "Editorial" dashboard
    And I add a "Platform" is "Instagram" filter inside the "Calendar" widget
    Then the "Calendar" widget shows nothing on "today"
    And the "Calendar" widget shows "Spring feature teaser" on "today + 7"
    When I sort the "Up next" widget by "Publish on" "descending"
    Then the "Up next" widget lists in order "Launch webinar recording, Keyboard shortcuts carousel, Spring feature teaser, Customer story: Hooli"
    # View mode: the filter and the sort stay on this device until saved.
    And the "Calendar" widget Filter button shows an unsaved dot
    And the "Up next" widget Sort button shows an unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    And the "Calendar" view has 0 saved filters
    And the "Up next" view has a saved "ascending" sort by "Publish on"
    When I reset the dashboard local conditions
    Then the "Calendar" widget shows "Customer story: Hooli" on "today"
    And the "Up next" widget lists in order "Customer story: Hooli, Spring feature teaser, Keyboard shortcuts carousel, Launch webinar recording"
    When I add a global filter where "Owner" is "Ravi"
    Then the "Up next" widget lists in order "Customer story: Hooli, Launch webinar recording"
    And the "Ideas" widget lists "Podcast guest pitch"
    And the "Calendar" widget shows "Customer story: Hooli" on "today"
    # Zoe's "Spring feature teaser" is the only post a week from today.
    And the "Calendar" widget shows nothing on "today + 7"
    And the "Published" widget shows the number "1"
    And the "Posts per week" chart shows these values:
      | label              | value |
      | week of today - 14 | 1     |
      | week of today      | 1     |
      | week of today + 21 | 1     |
      | No Publish on      | 1     |
    When I remove the global filter "Owner"
    And I add a global filter on "Platform" with the condition "Is empty" and the value ""
    Then the "Ideas" widget lists "Podcast guest pitch"
    And the "Up next" widget lists nothing
    And the "Published" widget shows no data
    And the "Platform share" chart total is "1"

  Scenario: The marketer fills the dashboard with new views from the widget picker
    When I open the "Editorial" dashboard
    And I switch the dashboard to Edit mode
    # "+" inserts a Count all Number widget and opens the picker beside it; the
    # row splits equally, and a new view type turns that widget's own view
    # into the type. Views made for widgets belong to the dashboard.
    And the user clicks the add button of dashboard row 3
    Then dashboard row 3 has widths "6, 6"
    And the second widget of dashboard row 3 is the selected Count all widget
    And the new widget shows the number "9" with the caption "Count all"
    When the user chooses the new view type "Calendar" in the "New view" picker
    Then the new widget shows a "Calendar" view of "Posts"
    When the user closes the "New view" picker
    And the user clicks the add button of dashboard row 3
    And the user chooses the new view type "List" in the "New view" picker
    Then the new widget shows a "List" view of "Posts"
    When the user closes the "New view" picker
    # Closing the picker keeps the Count all Number widget.
    And the user clicks the add button of dashboard row 3
    And the user closes the "New view" picker
    Then the new widget shows the number "9" with the caption "Count all"
    And dashboard row 3 has widths "3, 3, 3, 3"
    When the user clicks the add button of dashboard row 2
    And the user chooses the new view type "Gallery" in the "New view" picker
    Then the new widget shows a "Gallery" view of "Posts"
    When the user closes the "New view" picker
    And the user clicks the add button of dashboard row 2
    And the user chooses the new view type "Feed" in the "New view" picker
    Then the new widget shows a "Feed" view of "Posts"
    When the user closes the "New view" picker
    And the user clicks the add button of dashboard row 1
    And the user chooses the new view type "Board" in the "New view" picker
    Then the new widget shows a "Board" view of "Posts"
    When the user closes the "New view" picker
    Then the dashboard shows 12 widgets
    And dashboard row 1 has widths "3, 3, 3, 3"
    And dashboard row 2 has widths "3, 3, 3, 3"
    And the "Posts" database has 6 views created by the dashboard
    And the "Posts" tab bar does not show the view of widget 4
    And adding another widget is refused with the Dashboard is full tooltip
    When I finish editing the dashboard
    And I reload the dashboard
    Then the dashboard shows 12 widgets
    And the "Posts" database has 6 views created by the dashboard
