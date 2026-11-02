@dashboard @dashboard-usecase @cloud @large-database @timeout:3600000 @dashboard-template-4
Feature: HR headcount dashboard on the 5000-employee database
  Based on the "Department hiring" tab of Notion's Company Dashboard (total
  headcount by department, upcoming hires by month) and the "Headcount /
  Department size" widgets of its H1 tab. The people-ops analyst of a
  5,000-person company reviews headcount every week: departments, salaries
  per office, the hiring curve, the annual payroll and one site lead's
  team, and corrects a salary from the dashboard. A site lead narrows the
  page to her office for herself and resets it afterwards. It is the
  template large enough to exercise chart row loading (a chart counts a row
  only once its document has loaded), grid virtualization, the drill-down
  over hundreds of rows and a 28-point axis.

  # @dashboard-template-4 scopes the steps of dashboard-template-4.steps.ts,
  # shared with life-os.feature and training-log.feature. The desktop twin
  # is usecases/hr_headcount.feature, with the same scenarios.
  #
  # The data is the pinned 5000-employee fixture
  # (playwright/fixtures/database/afdb/employees_v3.afdb.gz, the desktop
  # oracle's employees_v3.afdb). The first scenario of a worker seeds it into
  # a use-case database, which takes minutes; the next scenarios of that
  # worker sign in to the same account and use that database, after putting
  # back the salary a scenario corrects. Like formula-large-database.feature
  # the feature runs only with RUN_LARGE_DATABASE=1:
  #   npx bddgen -c playwright.bdd.config.ts
  #   RUN_LARGE_DATABASE=1 npx playwright test -c playwright.bdd.config.ts --grep @dashboard-template-4 --workers=1
  #
  # Join dates are fixed timestamps at any hour of the day: 173 of them fall
  # within 14 hours of a month edge, so the browser runs in UTC and the month
  # buckets below are the UTC ones. Every total below was computed from the
  # fixture file. "prints these values" compares each value as the chart
  # prints it: an average of the US dollar Salary property shows whole
  # dollars from $1,000 on. "Active share" is the Notion calculation
  # "Percent checked" of the Active checkbox. In compact notation a currency
  # keeps its symbol, as in Notion ("Annual payroll" reads "$743.8M").
  #
  # "has counted all 5000 rows" waits until the chart has read every row, so
  # the exact totals after it prove every row was loaded and counted. The
  # "Berlin engineers" grid is virtualized: the step reads its row count and
  # its first rows. The fixture repeats some names, so the salary corrected
  # belongs to a Berlin engineer whose name is unique (Amelia Moore).
  #
  # In View mode a writer's new global filter is saved for everyone with its
  # default condition ("Active" is checked at once); the option chosen
  # afterwards stays private, so "Reset" takes "Office" back to no value.

  Background:
    Given the browser runs in the UTC time zone
    And a workspace for the "People ops" use case
    And an "Employees" database holding the 5000-employee fixture
    And "Employees" has these views:
      | view                     | layout               | settings                                                                      |
      | Headcount                | Number chart         | count, shown as compact                                                       |
      | Average salary           | Number chart         | average of Salary                                                             |
      | Active share             | Number chart         | percent checked of Active                                                     |
      | Remote split             | Donut chart          | count by Remote                                                               |
      | Headcount by department  | Bar chart            | count by Department                                                           |
      | Average salary by office | Horizontal bar chart | average of Salary by Office                                                   |
      | Hires per month          | Line chart           | count by Join Date per month                                                  |
      | Annual payroll           | Number chart         | sum of Salary, shown as compact                                               |
      | Berlin engineers         | Grid                 | sorted by Name ascending where Office is Berlin and Department is Engineering |
    And the "People" dashboard on "Employees" shows:
      | row | widgets                                               |
      | 1   | Headcount, Average salary, Active share, Remote split |
      | 2   | Headcount by department, Average salary by office     |
      | 3   | Hires per month, Annual payroll                       |
      | 4   | Berlin engineers                                      |

  Scenario: The weekly headcount review, then a salary correction
    When I open the "People" dashboard
    Then the "Remote split" chart has counted all 5000 rows
    And the "Headcount" widget shows the number "5K"
    And the "Average salary" widget shows the number "$148,762"
    And the "Annual payroll" widget shows the number "$743.8M"
    And the "Active share" widget shows the number "84.5%"
    And the "Headcount by department" chart shows these values:
      | label       | value |
      | Design      | 595   |
      | Engineering | 619   |
      | Finance     | 638   |
      | HR          | 660   |
      | Marketing   | 601   |
      | Product     | 654   |
      | Sales       | 629   |
      | Support     | 604   |
    And the "Average salary by office" chart prints these values:
      | label         | value    |
      | Berlin        | $150,336 |
      | London        | $145,709 |
      | New York      | $149,653 |
      | Remote        | $147,196 |
      | San Francisco | $148,565 |
      | Sydney        | $149,375 |
      | Tokyo         | $150,355 |
    And the "Hires per month" chart prints these values:
      | label    | value |
      | Jan 2023 | 185   |
      | Feb 2023 | 180   |
      | Mar 2023 | 186   |
      | Apr 2023 | 177   |
      | May 2023 | 204   |
      | Jun 2023 | 166   |
      | Jul 2023 | 168   |
      | Aug 2023 | 176   |
      | Sep 2023 | 202   |
      | Oct 2023 | 175   |
      | Nov 2023 | 169   |
      | Dec 2023 | 198   |
      | Jan 2024 | 200   |
      | Feb 2024 | 174   |
      | Mar 2024 | 189   |
      | Apr 2024 | 177   |
      | May 2024 | 179   |
      | Jun 2024 | 174   |
      | Jul 2024 | 182   |
      | Aug 2024 | 159   |
      | Sep 2024 | 173   |
      | Oct 2024 | 203   |
      | Nov 2024 | 169   |
      | Dec 2024 | 167   |
      | Jan 2025 | 186   |
      | Feb 2025 | 157   |
      | Mar 2025 | 194   |
      | Apr 2025 | 131   |
    And the "Berlin engineers" widget lists 89 rows starting with "Abigail Bailey, Alexander Lopez, Amelia Cooper, Amelia Moore"
    When I click the "Engineering" segment of the "Headcount by department" chart
    Then the drill-down is titled "Engineering"
    And the drill-down shows the category chip "Department: Engineering"
    And the drill-down shows the row count "619 rows"
    When I search the drill-down for "Amelia Moore"
    Then the drill-down lists "Amelia Moore"
    When I close the drill-down
    And I change the "Salary" of "Amelia Moore" to "205000" in the "Berlin engineers" widget
    Then the "Average salary" widget shows the number "$148,766"
    And the "Average salary by office" chart prints these values:
      | label         | value    |
      | Berlin        | $150,363 |
      | London        | $145,709 |
      | New York      | $149,653 |
      | Remote        | $147,196 |
      | San Francisco | $148,565 |
      | Sydney        | $149,375 |
      | Tokyo         | $150,355 |

  Scenario: A site lead looks at Berlin for herself, then resets the page
    When I open the "People" dashboard
    Then the "Remote split" chart has counted all 5000 rows
    When I add a global filter where "Office" is "Berlin"
    Then the "Office" global filter shows an unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    And the "Headcount" widget shows the number "744"
    And the "Average salary" widget shows the number "$150,336"
    And the "Active share" widget shows the number "86.2%"
    And the "Remote split" chart total is "744"
    And the "Headcount by department" chart shows these values:
      | label       | value |
      | Design      | 89    |
      | Engineering | 89    |
      | Finance     | 93    |
      | HR          | 106   |
      | Marketing   | 79    |
      | Product     | 99    |
      | Sales       | 96    |
      | Support     | 93    |
    And the "Berlin engineers" widget lists 89 rows starting with "Abigail Bailey, Alexander Lopez, Amelia Cooper"
    When I add a global filter on "Active" with the condition "Is checked"
    Then the "Headcount" widget shows the number "641"
    And the "Average salary" widget shows the number "$150,445"
    And the "Annual payroll" widget shows the number "$96.4M"
    And the "Active share" widget shows the number "100%"
    And the "Headcount by department" chart shows these values:
      | label       | value |
      | Design      | 78    |
      | Engineering | 72    |
      | Finance     | 76    |
      | HR          | 89    |
      | Marketing   | 71    |
      | Product     | 88    |
      | Sales       | 80    |
      | Support     | 87    |
    And the "Berlin engineers" widget lists 72 rows starting with "Abigail Bailey, Alexander Lopez, Amelia Cooper"
    When I click "Reset" in the filter bar
    Then the "Office" global filter pill reads "Office" and looks empty
    And the "Headcount" widget shows the number "4.2K"
    And the "Annual payroll" widget shows the number "$627.6M"
    And the "Active share" widget shows the number "100%"
    When I remove the global filter "Active"
    Then the "Headcount" widget shows the number "5K"
    And the "Berlin engineers" widget lists 89 rows starting with "Abigail Bailey, Alexander Lopez, Amelia Cooper"
