@formula @large-database
Feature: Formulas on the 5000 employees database
  The employees fixture is a pinned copy of the shared "5000_employees" grid:
  5000 rows and 20 fields of 10 types (text, number, date, select,
  multi-select, checkbox, URL, checklist, created and last edited time). It is
  rebuilt for a fresh account once per test worker; every scenario then starts
  from that copy with its own formula properties, filters, sorts and
  calculations removed.

  The suite is slow (seeding takes about 8 minutes on a local debug server) and
  is skipped unless RUN_LARGE_DATABASE is set:
    npx bddgen -c playwright.bdd.config.ts
    RUN_LARGE_DATABASE=1 npx playwright test -c playwright.bdd.config.ts --grep @large-database --workers=1
  EMPLOYEES_ROW_LIMIT seeds fewer rows for a quick run, and
  LARGE_DATABASE_CACHE=<file> reuses a seeded account across runs.

  Background:
    Given the 5000 employees database is open

  Scenario: The seeded database matches the fixture
    Then the grid lists every seeded row
    And the rows at the top, middle and bottom match the fixture

  Scenario: Formulas over every field type match the fixture on every part of the grid
    When I add these formula properties
      | name              | expression                                                         |
      | Upper name        | upper(prop("Name"))                                                |
      | Dept and office   | prop("Department") + " / " + prop("Office")                        |
      | Total pay         | prop("Salary") + prop("Bonus")                                     |
      | Rating x2         | prop("Performance") * 2                                            |
      | Status            | if(prop("Active"), "Active", "Inactive")                           |
      | Email domain      | split(prop("Email"), "@").last()                                   |
      | Skill list        | prop("Skills").join(", ")                                          |
      | Skill count       | prop("Skills").length()                                            |
      | Onboarded percent | prop("Onboarding")                                                 |
      | Joined            | formatDate(prop("Join Date"), "MM/DD/YYYY")                        |
      | First anniversary | formatDate(dateAdd(prop("Join Date"), 1, "years"), "YYYY-MM-DD")   |
      | Created day       | formatDate(prop("Created at"), "YYYY-MM-DD")                       |
      | Edited after      | prop("Last modified") >= prop("Created at")                        |
      | Annual pay        | prop("Total pay") * 12                                             |
    Then the formula properties match the fixture at the top, middle and bottom

  Scenario: Filtering by a formula lists the same rows as filtering by its input
    Given a formula property "Base pay" with the expression "prop("Salary")"
    When I filter "Salary" with the number condition "greater than" and value "150000"
    Then the grid lists the seeded rows whose Salary is above 150000
    When I remove the large database filters
    Then the grid lists every seeded row
    When I filter "Base pay" with the number condition "greater than" and value "150000"
    Then the grid lists the seeded rows whose Salary is above 150000
    And every listed row at the top and bottom has a Salary above 150000

  Scenario: Sorting by a formula orders every row
    Given a formula property "Total pay" with the expression "prop("Salary") + prop("Bonus")"
    When I sort "Total pay" descending
    Then the rows at the top and bottom are ordered by Salary plus Bonus, highest first

  Scenario: Calculations of a formula column match its input column
    Given a formula property "Base pay" with the expression "prop("Salary")"
    When I set the large database calculation of "Salary" to "Sum"
    And I set the large database calculation of "Base pay" to "Sum"
    Then the "Salary" and "Base pay" calculations show the same total

  Scenario: Editing an input updates the formulas that read it right away
    Given a formula property "Total pay" with the expression "prop("Salary") + prop("Bonus")"
    And a formula property "Annual pay" with the expression "prop("Total pay") * 12"
    When I type "190000" into row 1 of "Salary"
    Then row 1 of "Total pay" shows "197500" within 3 seconds
    And row 1 of "Annual pay" shows "2370000" within 3 seconds

  Scenario: Converting a formula column to Number keeps every value
    Given a formula property "Base pay" with the expression "prop("Salary")"
    When I switch the property "Base pay" to "Number"
    Then the property "Base pay" is a Number property within 900 seconds
    And "Base pay" matches the fixture Salary at the top, middle and bottom

  Scenario: The formula editor stays responsive on a large database
    When I start a new formula property
    And I type the formula "if(prop("Active") and prop("Salary") > 100000, prop("Salary") + prop("Bonus"), prop("Salary"))" in under 10 seconds
    Then the formula editor infers type "number"
    And the formula preview shows "192500"
