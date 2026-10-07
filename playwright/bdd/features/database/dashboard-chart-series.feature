@dashboard @dashboard-usecase @cloud
Feature: Dashboard chart sub-groups
  A chart can split every bar by a second property ("Group by"). Bars then
  stack one segment per group, stand side by side, or fill the axis as
  percentages. Each segment keeps its own drill-down, the tooltip lists every
  group of the hovered bar, and a chart with too many groups shows the first
  ones with a note.

  Background:
    Given a workspace for the "Content calendar" use case
    And a "Content" database with these properties:
      | property | type   | options                  |
      | Channel  | Select | Blog, Video, Podcast     |
      | Audience | Select | Business, Consumers, SMB |
      | Reach    | Number |                          |
    And "Content" has these rows:
      | Name         | Channel | Audience  | Reach |
      | Launch post  | Blog    | Business  | 100   |
      | Pricing post | Blog    | Consumers | 50    |
      | Tips post    | Blog    | Consumers | 30    |
      | Demo video   | Video   | SMB       | 200   |
      | Webinar      | Video   | Business  | 10    |
      | Episode 1    | Podcast | Consumers | 40    |
      | Episode 2    | Podcast |           | 5     |
    And "Content" has these views:
      | view             | layout               | settings                                            |
      | Posts by channel | Bar chart            | count by Channel, group by Audience                 |
      | Reach by channel | Bar chart            | sum of Reach by Channel, group by Audience, grouped |
      | Audience mix     | Horizontal bar chart | count by Channel, group by Audience, percent        |
      | Audience lines   | Line chart           | count by Channel, group by Audience, percent        |
      | Plain posts      | Bar chart            | count by Channel                                    |

  Scenario: A bar chart grouped by a second property stacks one segment per group
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Posts by channel |
    Then the "Posts by channel" chart stacks its bars
    And the "Posts by channel" chart legend lists "Business, Consumers, SMB, No Audience"
    And the "Posts by channel" chart shows "Blog" as "Business 1, Consumers 2"
    And the "Posts by channel" chart shows "Podcast" as "Consumers 1, No Audience 1"
    And the "Posts by channel" chart labels its bars "3, 2, 2"

  Scenario: The tooltip of a stacked bar names the category and lists each group
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Posts by channel |
    When I hover the "Video" bar of the "Posts by channel" chart
    Then the chart tooltip is titled "Video" and lists "Business 1, SMB 1"
    And the chart tooltip ends with "Click to view data"

  Scenario: Grouped bars stand side by side with a label on each bar
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Reach by channel |
    Then the "Reach by channel" chart draws its bars side by side
    And the "Reach by channel" chart shows "Blog" as "Business 100, Consumers 80"
    And the "Reach by channel" chart labels its bars "100, 80, 10, 200, 40, 5"

  Scenario: Percent bars fill the axis and the tooltip shows each share
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets      |
      | 1   | Audience mix |
    Then the "Audience mix" chart draws its bars as percentages
    And the "Audience mix" chart shows no data labels
    When I hover the "Blog" bar of the "Audience mix" chart
    Then the chart tooltip is titled "Blog" and lists "Business 33.3% (1), Consumers 66.7% (2)"

  Scenario: Clicking a segment opens only the rows of that group
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Posts by channel |
    When I click the "Consumers" segment of the "Blog" bar in the "Posts by channel" chart
    Then the drill-down lists "Pricing post, Tips post"

  Scenario: Clicking beside grouped bars opens the whole category
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Reach by channel |
    When I click beside the "Video" bars of the "Reach by channel" chart
    Then the drill-down lists "Demo video, Webinar"

  Scenario: The chart settings add a Group by and switch the group style
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets     |
      | 1   | Plain posts |
    Then the "Plain posts" chart draws one bar per category
    When I switch the dashboard to Edit mode
    And I open the "Settings" tool of the "Plain posts" widget
    Then the chart settings show "Group by" as "None"
    And the chart settings do not show "Group style"
    When I set the chart "Group by" to "Audience"
    Then the chart settings offer the group styles "Stacked, Grouped, Percent" with "Stacked" selected
    And the "Plain posts" chart stacks its bars
    When I choose the "Grouped" group style
    Then the "Plain posts" chart draws its bars side by side
    When I reload the dashboard
    Then the "Plain posts" chart draws its bars side by side
    And the "Plain posts" chart legend lists "Business, Consumers, SMB, No Audience"
    When I switch the dashboard to Edit mode
    And I open the "Settings" tool of the "Plain posts" widget
    And I set the chart "Group by" to "None"
    Then the "Plain posts" chart draws one bar per category
    And the chart settings do not show "Group style"

  Scenario: A donut hides Group by and keeps it for when the chart is a bar chart again
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets          |
      | 1   | Posts by channel |
    When I switch the dashboard to Edit mode
    And I open the "Settings" tool of the "Posts by channel" widget
    And I choose the "Donut" chart type
    Then the chart settings do not show "Group by"
    And the "Posts by channel" chart total is "7"
    When I choose the "Vertical bar" chart type
    Then the chart settings show "Group by" as "Audience"
    And the "Posts by channel" chart stacks its bars

  Scenario: A line chart draws one line per group and ignores the group style
    Given the "Content hub" dashboard on "Content" shows:
      | row | widgets        |
      | 1   | Audience lines |
    Then the "Audience lines" chart draws 4 lines
    And the "Audience lines" chart legend lists "Business, Consumers, SMB, No Audience"
    And the "Audience lines" chart shows "Blog" as "Business 1, Consumers 2"
    And the "Audience lines" chart shows no data labels

  Scenario: A chart with more than 50 groups shows the first 50 and says so
    Given a "Tags" database whose 52 rows are tagged "T01" to "T52"
    And "Tags" has these views:
      | view   | layout    | settings                    |
      | By tag | Bar chart | count by Kind, group by Tag |
    And the "Tag board" dashboard on "Tags" shows:
      | row | widgets |
      | 1   | By tag  |
    Then the "By tag" chart draws 50 groups
    And the "By tag" chart does not draw the groups "T51, T52"
    And the "By tag" chart says "Only showing the first 50 groups"
