@formula @nathan-employees
Feature: Real-world formulas on Nathan's 5000_employees database
  Formulas people write in Notion (sources in notion-use-cases.test.ts),
  adapted to an employee directory, run on the shared "5000_employees" grid of
  the local nathan@appflowy.io account. Every result is checked against the
  row's own data, computed independently of the formula engine, at the top,
  middle and bottom of the grid. Properties named "UC …", filters, sorts,
  calculations and edited cells are removed or restored after each scenario.

  The database is a local fixture, so the feature is skipped unless
  RUN_NATHAN_EMPLOYEES is set:
    npx bddgen -c playwright.bdd.config.ts
    RUN_NATHAN_EMPLOYEES=1 npx playwright test -c playwright.bdd.config.ts --grep @nathan-employees --workers=1
  NATHAN_EMAIL, NATHAN_PASSWORD and NATHAN_EMPLOYEES_PATH override the account
  and database; FORMULA_MEDIA_DIR=<dir> saves screenshots and a video there.

  Background:
    Given Nathan's 5000_employees database is open

  Scenario: Real-world formulas are right on every part of the grid
    When I add these formula properties
      | name                  | expression                                                                                                                                                                  |
      | UC First name         | prop("Name").split(" ").first()                                                                                                                                             |
      | UC Initials           | prop("Name").split(" ").map(substring(current, 0, 1)).join("")                                                                                                             |
      | UC Total comp         | formatNumber(prop("Salary") + prop("Bonus"), "usd", 0)                                                                                                                      |
      | UC Pay mix            | if(prop("Salary") > 0, round(prop("Bonus") / prop("Salary") * 100, 1), 0) + "% bonus"                                                                                     |
      | UC Band               | ifs(prop("Salary") >= 150000, "Senior band", prop("Salary") >= 100000, "Mid band", "Junior band")                                                                         |
      | UC Top earner         | let(total, prop("Salary") + prop("Bonus"), if(total > 200000, "Top earner", "Standard"))                                                                                  |
      | UC Tenure             | dateBetween(today(), prop("Join Date"), "years") + " yrs"                                                                                                                  |
      | UC Next anniversary   | formatDate(dateAdd(prop("Join Date"), dateBetween(today(), prop("Join Date"), "years") + 1, "years"), "YYYY-MM-DD")                                                        |
      | UC Joined             | formatDate(prop("Join Date"), "ddd, D MMM, Y")                                                                                                                             |
      | UC Joined quarter     | "Q" + format(ceil(month(prop("Join Date")) / 3)) + " " + formatDate(prop("Join Date"), "Y") + ", " + formatDate(prop("Join Date"), "[week] wo")                          |
      | UC Onboarding bar     | substring("▓▓▓▓▓▓▓▓▓▓", 0, floor(prop("Onboarding") / 10)) + substring("░░░░░░░░░░", 0, 10 - floor(prop("Onboarding") / 10)) + " " + prop("Onboarding") + "%"            |
      | UC Readiness          | if(not prop("Active"), "⚪ Inactive", if(prop("Onboarding") == 100, "🟢 Ready", "🟡 Onboarding"))                                                                           |
      | UC Status             | if(prop("Active"), "✅ Active", "❌ Inactive")                                                                                                                                |
      | UC Where              | if(prop("Active"), if(prop("Remote"), "Remote", "On-site in " + prop("Office")), "Inactive")                                                                              |
      | UC Skills sentence    | prop("UC First name") + " has " + prop("Skills").length() + " skills"                                                                                                      |
      | UC Knows Python       | prop("Skills").includes("Python")                                                                                                                                          |
      | UC Languages          | prop("Languages").sort().join(" · ")                                                                                                                                       |
      | UC Website            | "https://www." + prop("Email").split("@").last()                                                                                                                           |
      | UC LinkedIn handle    | replaceAll(prop("LinkedIn"), ".*linkedin.com/in/", "")                                                                                                                     |
      | UC Phone              | "tel:" + replaceAll(prop("Phone"), "[^0-9+]", "")                                                                                                                          |
      | UC Stars              | ifs(prop("Performance") >= 4.5, "⭐⭐⭐", prop("Performance") >= 3.5, "⭐⭐", "⭐")                                                                                            |
      | UC Seniority          | ifs(prop("Years of Experience") >= 10, "Principal", prop("Years of Experience") >= 5, "Senior", "Junior")                                                                 |
      | UC Title line         | prop("Job Title") + " (" + prop("UC Seniority") + ")"                                                                                                                      |
      | UC Reports to         | if(empty(prop("Manager")), "No manager", "Reports to " + prop("Manager").split(" ").first())                                                                              |
      | UC Days since edit    | dateBetween(now(), prop("Last modified"), "days")                                                                                                                          |
      | UC Created weekday    | formatDate(prop("Created at"), "dddd")                                                                                                                                     |
    Then the use-case formulas match each row's data at the top, middle and bottom of the grid
    And I save a screenshot "01-use-case-columns" of the columns "Name, UC Total comp, UC Band, UC Tenure, UC Readiness, UC Where, UC Stars, UC Onboarding bar"
    When I open the row page of the first employee
    Then the row page shows the use-case formulas for that employee
    And I save a screenshot "02-row-page"

  Scenario: Filters, sorts and calculations on formulas agree with their inputs
    When I add these formula properties
      | name         | expression                                                                                                 |
      | UC Seniority | ifs(prop("Years of Experience") >= 10, "Principal", prop("Years of Experience") >= 5, "Senior", "Junior") |
      | UC Total pay | prop("Salary") + prop("Bonus")                                                                             |
      | UC Base      | prop("Salary")                                                                                             |
    And I filter "Years of Experience" with the number condition "greater than or equal to" and value "10"
    And I remember the number of listed employees as "principal by experience"
    And I remove the employees filters
    And I filter "UC Seniority" with the text condition "is" and value "Principal"
    Then the grid lists as many employees as "principal by experience"
    And the listed employees at the top and bottom all have at least 10 years of experience
    And I save a screenshot "03-filter-by-formula" of the columns "Name, Years of Experience, UC Seniority"
    When I remove the employees filters
    And I sort "UC Total pay" descending
    Then the employees at the top and bottom are ordered by Salary plus Bonus, highest first
    And I save a screenshot "04-sort-by-formula" of the columns "Name, Salary, Bonus, UC Total pay"
    When I remove all sorts
    And I set the large database calculation of "Salary" to "Sum"
    And I set the large database calculation of "UC Base" to "Sum"
    Then the "Salary" and "UC Base" calculations show the same total

  Scenario: Editing an employee updates the formulas that read it
    When I add these formula properties
      | name          | expression                                                                               |
      | UC Total pay  | prop("Salary") + prop("Bonus")                                                           |
      | UC Top earner | let(total, prop("Salary") + prop("Bonus"), if(total > 200000, "Top earner", "Standard")) |
    And I change the first employee's "Bonus" to "123456"
    Then the first employee's "UC Total pay" shows Salary plus Bonus within 3 seconds
    And the first employee's "UC Top earner" shows "Top earner" within 3 seconds

  Scenario: Writing formulas, recorded
    Given a recording window on Nathan's 5000_employees database
    When I write the formula "if(prop("Active"), round(prop("Bonus") / prop("Salary") * 100, 1), 0)" as "UC Bonus share" in the recording window
    And I show "UC Bonus share" as a bar divided by 20 with its number in the recording window
    And I write the formula "prop("Name").split(" ").first() + " · " + prop("Skills").join(", ")" as "UC Profile" in the recording window
    Then the recording window shows the columns "Name, UC Bonus share, UC Profile"
    And I save the recording
