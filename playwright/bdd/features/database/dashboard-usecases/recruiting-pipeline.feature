@dashboard @dashboard-usecase @dashboard-template-1 @cloud
Feature: Recruiting pipeline dashboard
  Based on Kanri no Yamada's recruiting dashboards (an applicant count, a
  "percent checked" screening-pass tile, applicants by source, a role donut
  and an in-process table) and the "Department hiring" tab of Notion's
  Company Dashboard (hiring pipeline, interview list). The recruiter moves
  candidates on the board and opens their cards every morning; the hiring
  manager, who can edit the space, narrows the page to engineering for
  everybody and gives the candidate gallery more room.

  # "Interview score" uses the Percent number format: a cell holds a ratio
  # (0.9) and shows "90%". The Number card's "Auto" format follows the
  # property's format, so the average reads "73.33%".
  #
  # The templates this one is modelled on keep an application form next to
  # the tiles. A Form view in a web widget shows the form builder (its
  # authoring page), not a form to fill in, so this template shows the
  # interview list in that slot on both clients.
  #
  # Records opened from a widget open in a side peek (Notion's default for a
  # dashboard). A filter or sort a viewer changes in View mode stays theirs
  # until someone who can edit saves it for everyone.

  Background:
    Given a workspace for the "Recruiting" use case
    And a "Candidates" database with these properties:
      | property        | type     | options                                               |
      | Role            | Select   | Engineer, Designer, PM                                |
      | Source          | Select   | Referral, Website, LinkedIn, Agency                   |
      | Stage           | Select   | Applied, Screening, Interview, Offer, Hired, Rejected |
      | Screen passed   | Checkbox |                                                       |
      | Years           | Number   |                                                       |
      | Interview score | Number   | Percent                                               |
    And "Candidates" has these rows:
      | Name          | Role     | Source   | Stage     | Screen passed | Years | Interview score |
      | Aiko Tanaka   | Engineer | Referral | Interview | yes           | 6     | 0.9             |
      | Ben Okafor    | Engineer | Website  | Screening | no            | 3     |                 |
      | Chloé Martin  | Designer | LinkedIn | Offer     | yes           | 5     | 0.85            |
      | Diego Alvarez | PM       | Agency   | Applied   | no            | 8     |                 |
      | Emma Schulz   | Engineer | Referral | Hired     | yes           | 4     | 0.8             |
      | Farah Haddad  | Designer | Website  | Interview | yes           | 2     | 0.7             |
      | Gustav Berg   | Engineer | LinkedIn | Rejected  | no            | 1     | 0.4             |
      | Hana Kim      | PM       | Referral | Screening | yes           | 7     |                 |
      | Ivan Petrov   | Engineer | Agency   | Applied   | no            | 5     |                 |
      | Julia Rossi   | Designer | Referral | Interview | yes           | 3     | 0.75            |
    And "Candidates" has these views:
      | view                    | layout       | settings                                   |
      | Applicants              | Number chart | count                                      |
      | Screen pass rate        | Number chart | percent checked of Screen passed           |
      | Average interview score | Number chart | average of Interview score                 |
      | By role                 | Donut chart  | count by Role                              |
      | By source               | Bar chart    | count by Source                            |
      | Interviews              | List         | where Stage is Interview                   |
      | Pipeline                | Board        | grouped by Stage                           |
      | Candidate cards         | Gallery      |                                            |
      | In process              | Grid         | where Stage is Screening, Interview, Offer |
    And the "Hiring" dashboard on "Candidates" shows:
      | row | widgets                                                        |
      | 1   | Applicants, Screen pass rate, Average interview score, By role |
      | 2   | By source, Interviews                                          |
      | 3   | Pipeline                                                       |
      | 4   | Candidate cards, In process                                    |

  Scenario: The recruiter's morning pipeline check
    When I open the "Hiring" dashboard
    Then the "Applicants" widget shows the caption "Count all" above the number "10"
    And the "Screen pass rate" widget shows the caption "Percent checked of Screen passed" above the number "60%"
    And the "Average interview score" widget shows the caption "Average of Interview score" above the number "73.33%"
    And the "By role" chart total is "10"
    And the "By source" chart shows these values:
      | label    | value |
      | Referral | 4     |
      | Website  | 2     |
      | LinkedIn | 2     |
      | Agency   | 2     |
    And the "Interviews" widget lists "Aiko Tanaka, Farah Haddad, Julia Rossi"
    And the "Pipeline" board column "Interview" has the cards "Aiko Tanaka, Farah Haddad, Julia Rossi"
    And the "In process" widget lists "Ben Okafor, Chloé Martin, Aiko Tanaka, Farah Haddad, Hana Kim, Julia Rossi"
    When I open the "Chloé Martin" row from the "Pipeline" widget
    Then "Chloé Martin" opens in a side peek
    When I close the side peek
    And I open the "Farah Haddad" row from the "Candidate cards" widget
    Then "Farah Haddad" opens in a side peek

  Scenario: Moving candidates along the board updates every widget
    When I open the "Hiring" dashboard
    And I drag the "Aiko Tanaka" card to the "Offer" column in the "Pipeline" widget
    Then the "Pipeline" board column "Offer" has the cards "Chloé Martin, Aiko Tanaka"
    And the "Stage" of "Aiko Tanaka" in "Candidates" is "Offer"
    And the "Interviews" widget lists "Farah Haddad, Julia Rossi"
    And the "In process" widget lists "Ben Okafor, Chloé Martin, Aiko Tanaka, Farah Haddad, Hana Kim, Julia Rossi"
    When I drag the "Hana Kim" card to the "Interview" column in the "Pipeline" widget
    Then the "Pipeline" board column "Interview" has the cards "Farah Haddad, Julia Rossi, Hana Kim"
    And the "Interviews" widget lists "Farah Haddad, Julia Rossi, Hana Kim"
    When I change the "Screen passed" of "Ben Okafor" to "checked" in the "In process" widget
    Then the "Screen pass rate" widget shows the number "70%"
    And the "Screen passed" of "Ben Okafor" in "Candidates" is "checked"

  Scenario: A recruiter looks at referrals and sorts the gallery privately, then resets
    When I open the "Hiring" dashboard
    And I add a "Source" is "Referral" filter inside the "Pipeline" widget
    Then the "Pipeline" widget shows the cards "Aiko Tanaka, Emma Schulz, Hana Kim, Julia Rossi"
    When I sort the "Candidate cards" widget by "Name" "descending"
    Then the "Candidate cards" widget lists in order "Julia Rossi, Ivan Petrov, Hana Kim, Gustav Berg, Farah Haddad, Emma Schulz, Diego Alvarez, Chloé Martin, Ben Okafor, Aiko Tanaka"
    And the "Pipeline" widget Filter button shows an unsaved dot
    And the "Candidate cards" widget Sort button shows an unsaved dot
    And the filter bar shows "Reset" and "Save for everyone"
    And the "Pipeline" view has 0 saved filters
    And the "Candidate cards" view has 0 saved sorts
    When I reset the dashboard local conditions
    Then the "Pipeline" widget shows the cards "Aiko Tanaka, Ben Okafor, Chloé Martin, Diego Alvarez, Emma Schulz, Farah Haddad, Gustav Berg, Hana Kim, Ivan Petrov, Julia Rossi"
    And the "Candidate cards" widget has no active sort
    And no unsaved dot is shown on the dashboard

  Scenario: The hiring manager can edit: engineering-only for everybody and a wider gallery
    Given a teammate who can edit the "Recruiting" space
    When the teammate opens the "Hiring" dashboard
    Then the teammate sees the dashboard in View mode with an Edit button
    When the teammate adds a global filter where "Role" is "Engineer"
    Then the teammate sees the "In process" widget list "Ben Okafor, Aiko Tanaka"
    And the teammate sees "Reset" and "Save for everyone" in the filter bar
    When the teammate clicks "Save for everyone" in the filter bar
    And the teammate switches the dashboard to Edit mode
    And the teammate resizes "Candidate cards" to 8 columns
    And the teammate finishes editing the dashboard
    And I open the "Hiring" dashboard
    Then the widths of dashboard row 4 are "8, 4"
    And the "Role" global filter pill reads "Role: Engineer"
    And the "Applicants" widget shows the number "5"
    And the "Screen pass rate" widget shows the number "40%"
    And the "Average interview score" widget shows the number "70%"
    And the "In process" widget lists "Ben Okafor, Aiko Tanaka"
    And no unsaved dot is shown on the dashboard
