@dashboard @dashboard-usecase @dashboard-template-1 @cloud
Feature: Marketing budget versus actual spend
  Based on the "Marketing Budget - Budget Dashboard (EUR)" template (budget
  allocation donut, planned versus actual bars, spend by category, line-item
  table), the CMO Operating System's multi-source budget page, and the CFO
  Executive Snapshot's sum and median number tiles. Marketing ops closes the
  month from this page, often in half of a laptop screen: medians and
  minimums spot outliers, the invoice tiles show how much is paid, and a
  spend threshold filters both the budget lines and the invoices at once.

  # Planned, Actual and Amount use the Euro number format, so the Number
  # cards print the way the cells do: de-DE grouping, two decimals below
  # 1,000 ("€75.200", "€600,00"). A donut centre is compact from 10,000 on and
  # keeps the currency symbol ("€60.8K"). Invoice due dates sit 35 days
  # apart, so each offset is its own calendar month on any run date; a label
  # written as "month of today - 35" resolves to the product's month label.
  #
  # A donut counts or sums, as in Notion (its Calculate menu offers no
  # average), so the owner donut shows spend; the averages and the median
  # live in the bar chart and the Number cards.
  #
  # The dashboard holds 12 widgets, the maximum. In a window narrower than a
  # four-up row needs (four 240 px widgets), a row of four wraps two by two,
  # as in Notion.

  Background:
    Given a workspace for the "Marketing budget" use case
    And a "Budget items" database with these properties:
      | property | type   | options                                  |
      | Category | Select | Paid ads, Events, Content, Tools, Agency |
      | Planned  | Number | Euro                                     |
      | Actual   | Number | Euro                                     |
      | Owner    | Select | Lena, Marco                              |
    And "Budget items" has these rows:
      | Name              | Category | Planned | Actual | Owner |
      | LinkedIn lead ads | Paid ads | 12000   | 13500  | Lena  |
      | Search campaign   | Paid ads | 9000    | 8100   | Marco |
      | Retargeting       | Paid ads | 4000    | 3000   | Marco |
      | SaaStr booth      | Events   | 20000   | 22000  | Lena  |
      | Customer meetup   | Events   | 6000    | 4800   | Lena  |
      | Case study videos | Content  | 8000    | 7600   | Marco |
      | Design tools      | Tools    | 1200    | 1200   | Marco |
      | Brand refresh     | Agency   | 15000   |        | Lena  |
      | Offsite snacks    |          |         | 600    | Marco |
    And an "Invoices" database with these properties:
      | property | type     | options                                          |
      | Vendor   | Select   | LinkedIn, Google, Eventbrite, Studio Nord, Figma |
      | Amount   | Number   | Euro                                             |
      | Paid     | Checkbox |                                                  |
      | Due      | Date     |                                                  |
    And "Invoices" has these rows:
      | Name                | Vendor      | Amount | Paid | Due        |
      | INV-101 LinkedIn    | LinkedIn    | 13500  | yes  | today - 35 |
      | INV-102 Google      | Google      | 8100   | yes  | today - 35 |
      | INV-103 Google      | Google      | 3000   | no   | today + 35 |
      | INV-104 Eventbrite  | Eventbrite  | 22000  | yes  | today      |
      | INV-105 Studio Nord | Studio Nord | 7600   | no   | today + 35 |
      | INV-106 Figma       | Figma       | 1200   | yes  | today      |
    And "Budget items" has these views:
      | view                      | layout               | settings                      |
      | Planned budget            | Number chart         | sum of Planned                |
      | Spent                     | Number chart         | sum of Actual                 |
      | Median line item          | Number chart         | median of Actual              |
      | Smallest line item        | Number chart         | min of Actual                 |
      | Average spend by category | Bar chart            | average of Actual by Category |
      | Spend by category         | Donut chart          | sum of Actual by Category     |
      | Spend by owner            | Donut chart          | sum of Actual by Owner        |
      | Biggest item by owner     | Horizontal bar chart | max of Actual by Owner        |
    And "Invoices" has these views:
      | view               | layout       | settings                                           |
      | Invoices paid      | Number chart | percent checked of Paid, titled "Invoices paid"    |
      | Payment runs       | Number chart | count unique values of Due, titled "Payment dates" |
      | Invoiced per month | Line chart   | sum of Amount by Due per month                     |
      | Open invoices      | Grid         | where Paid is unchecked                            |
    And the "Budget" dashboard on "Budget items" shows:
      | row | widgets                                                                             |
      | 1   | Planned budget, Spent, Median line item, Smallest line item                         |
      | 2   | Average spend by category, Spend by category, Spend by owner, Biggest item by owner |
      | 3   | Invoices paid, Payment runs, Invoiced per month, Open invoices                      |

  Scenario: Month-end close read-out, also in half of a laptop screen
    When I open the "Budget" dashboard
    Then the "Planned budget" widget shows the caption "Sum of Planned" above the number "€75.200"
    And the "Spent" widget shows the number "€60.800"
    And the "Median line item" widget shows the caption "Median of Actual" above the number "€6.200"
    And the "Smallest line item" widget shows the caption "Min of Actual" above the number "€600,00"
    And the "Average spend by category" chart shows these values:
      | label       | value  |
      | Paid ads    | 8,200  |
      | Events      | 13,400 |
      | Content     | 7,600  |
      | Tools       | 1,200  |
      | Agency      | 0      |
      | No Category | 600    |
    And the "Spend by category" chart total reads "€60.8K"
    And the "Spend by owner" chart total reads "€60.8K"
    And the "Biggest item by owner" chart shows these values:
      | label | value  |
      | Lena  | 22,000 |
      | Marco | 8,100  |
    And the "Invoices paid" widget shows the caption "Invoices paid" above the number "66.7%"
    And the "Payment runs" widget shows the caption "Payment dates" above the number "3"
    And the "Invoiced per month" chart shows these values:
      | label               | value  |
      | month of today - 35 | 21,600 |
      | month of today      | 23,200 |
      | month of today + 35 | 10,600 |
    And the "Open invoices" widget lists "INV-103 Google, INV-105 Studio Nord"
    When I click the "Lena" segment of the "Spend by owner" chart
    Then the drill-down lists "LinkedIn lead ads, SaaStr booth, Customer meetup, Brand refresh"
    When I close the drill-down
    And the dashboard rows are 640 pixels wide
    Then the dashboard row 1 is laid out in lines of "2, 2"
    And the dashboard row 2 is laid out in lines of "2, 2"
    And the "Planned budget" widget shows the number "€75.200"
    And the number of the "Planned budget" widget is not truncated
    And the number of the "Spent" widget is not truncated

  Scenario: Big-ticket review across the budget lines and the invoices
    When I open the "Budget" dashboard
    And I add a global filter on "Actual" with the condition "Is greater than or equal to" and the value "5000", using:
      | property | database |
      | Amount   | Invoices |
    Then the "Actual" global filter chip shows 2 sources
    And the "Planned budget" widget shows the number "€49.000"
    And the "Spent" widget shows the number "€51.200"
    And the "Median line item" widget shows the number "€10.800"
    And the "Smallest line item" widget shows the number "€7.600"
    And the "Average spend by category" chart shows these values:
      | label    | value  |
      | Paid ads | 10,800 |
      | Events   | 22,000 |
      | Content  | 7,600  |
    And the "Spend by owner" chart total reads "€51.2K"
    And the "Invoices paid" widget shows the number "75%"
    And the "Payment runs" widget shows the number "3"
    And the "Open invoices" widget lists "INV-105 Studio Nord"
    And the "Invoiced per month" chart shows these values:
      | label               | value  |
      | month of today - 35 | 21,600 |
      | month of today      | 22,000 |
      | month of today + 35 | 7,600  |
    When I remove the global filter "Actual"
    Then the "Planned budget" widget shows the number "€75.200"

  Scenario: Everything except events, with the invoices left untouched
    When I open the "Budget" dashboard
    And I add a global filter on "Category" with the condition "Is not" and the value "Events"
    Then the "Category" global filter chip shows 1 source
    And the "Planned budget" widget shows the number "€49.200"
    And the "Spent" widget shows the number "€34.000"
    And the "Median line item" widget shows the number "€5.300"
    And the "Average spend by category" chart shows these values:
      | label       | value |
      | Paid ads    | 8,200 |
      | Content     | 7,600 |
      | Tools       | 1,200 |
      | Agency      | 0     |
      | No Category | 600   |
    And the "Spend by owner" chart total reads "€34K"
    And the "Biggest item by owner" chart shows these values:
      | label | value  |
      | Lena  | 13,500 |
      | Marco | 8,100  |
    And the "Invoices paid" widget shows the number "66.7%"
    And the "Open invoices" widget lists "INV-103 Google, INV-105 Studio Nord"

  Scenario: Tidying the category chart in Edit mode: the median, then no uncategorised spend
    When I open the "Budget" dashboard
    And I switch the dashboard to Edit mode
    Then adding another widget is refused with the Dashboard is full tooltip
    When I open the settings of the "Average spend by category" widget
    And I set the chart Y axis to "Actual" with "Median"
    Then the "Average spend by category" chart shows these values:
      | label       | value  |
      | Paid ads    | 8,100  |
      | Events      | 13,400 |
      | Content     | 7,600  |
      | Tools       | 1,200  |
      | Agency      | 0      |
      | No Category | 600    |
    When I turn off "Show empty values" in the chart settings
    Then the "Average spend by category" chart shows these values:
      | label    | value  |
      | Paid ads | 8,100  |
      | Events   | 13,400 |
      | Content  | 7,600  |
      | Tools    | 1,200  |
      | Agency   | 0      |
    When I close the "View settings" panel
    And I finish editing the dashboard
    And I reload the dashboard
    Then the "Average spend by category" chart shows these values:
      | label    | value  |
      | Paid ads | 8,100  |
      | Events   | 13,400 |
      | Content  | 7,600  |
      | Tools    | 1,200  |
      | Agency   | 0      |
