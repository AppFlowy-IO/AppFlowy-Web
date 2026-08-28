@published-relation-template @mode:serial
Feature: Published database templates preserve relations
  This scenario reuses the `pdf_db_relation@appflowy.io` fixture documented in
  `AppFlowy-Cloud-Premium/backup/README.md`. Its `New Database` Grid has a
  Relation field that points to `Related DB`, whose row title is
  `Related DB content`. The matching server regression fixture is documented in
  `tests/workspace/publish/duplication_test.rs` by
  `publishing_only_database_with_relation_includes_related_database_in_template`.

  Background:
    Given the seeded relation template fixture exists

  Scenario: Another account starts with a published database that has a relation
    Given I sign in as the relation template fixture publisher
    And the seeded relation cell resolves before publishing
    When I publish only the seeded source database as a template
    And another account opens the published relation template
    Then the published relation cell shows "Related DB content"
    When that account starts with the relation template in "General"
    Then the destination space request uses depth 2
    And the relation template duplication contains 2 database mappings
    And the duplicated relation database is named "Related DB"
    And the duplicated relation cell shows "Related DB content"
    And the duplicated relation cell does not show "No access"
    When I clear the duplication mappings and reload the duplicated relation template
    Then the duplicated relation cell shows "Related DB content"
    And the duplicated relation cell does not show "No access"
