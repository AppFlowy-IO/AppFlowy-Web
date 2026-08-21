@published-document-template-dependencies @mode:serial
Feature: Published document templates preserve referenced content
  These scenarios reuse the `duplicate@appflowy.io` fixture documented by
  `AppFlowy-Cloud-Premium/tests/workspace/page_view/duplication_test.rs`.
  Its `DB 1` database contains `db 1 row 1`, while `DB 2` contains the rows
  `Row with linked database` and `Row with inline database`; each DB 2 row page
  contains the corresponding nested database kind. Temporary source documents
  are created in that fixture workspace and removed during teardown.

  Every scenario publishes only the temporary root document. A newly registered,
  different account then opens the public page, clicks "Start with this template",
  adds it to General, and validates the resulting private workspace copy.

  Background:
    Given I sign in as the seeded document dependency publisher

  Scenario: A document template deep-copies a referenced database view
    Given a temporary document template contains a referenced view of database "DB 1"
    And the source referenced database shows "db 1 row 1"
    When I publish only the temporary document template
    And a different account starts with the published document template in "General"
    Then the duplicated referenced database shows "db 1 row 1"
    And the duplicated referenced database remains available after reload

  Scenario: A document template deep-copies an inline database view
    Given a temporary document template contains an inline database with identifiable row data
    When I publish only the temporary document template
    And a different account starts with the published document template in "General"
    Then the duplicated inline database has an independent database identity
    And the duplicated inline database row remains available after reload

  Scenario: A document template deep-copies a referenced page
    Given a temporary document template contains a reference to another temporary page
    When I publish only the temporary document template
    And a different account starts with the published document template in "General"
    Then the duplicated page reference points to a new accessible page copy

  Scenario: A referenced database preserves a nested referenced database in a row page
    Given a temporary document template contains a referenced view of nested fixture database "DB 2"
    And the source referenced database contains nested rows "Row with linked database" and "Row with inline database"
    When I publish only the temporary document template
    And a different account starts with the published document template in "General"
    Then the duplicated referenced database contains nested rows "Row with linked database" and "Row with inline database"
    And row "Row with linked database" has an available nested referenced database
    And the nested database in row "Row with linked database" remains available after reload

  Scenario: A referenced database preserves a nested inline database in a row page
    Given a temporary document template contains a referenced view of nested fixture database "DB 2"
    And the source referenced database contains nested rows "Row with linked database" and "Row with inline database"
    When I publish only the temporary document template
    And a different account starts with the published document template in "General"
    Then the duplicated referenced database contains nested rows "Row with linked database" and "Row with inline database"
    And row "Row with inline database" has an available nested inline database
    And the nested database in row "Row with inline database" remains available after reload
