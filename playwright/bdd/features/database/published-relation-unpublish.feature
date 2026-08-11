@published-relation-template @relation-unpublish-regression @mode:serial
Feature: Unpublishing a relation-backed database
  Publishing a database can automatically publish the database referenced by a
  relation field. Unpublishing the source database must remove both publications
  from the published pages list.

  Background:
    Given the seeded relation template fixture exists

  Scenario: The automatically published relation target is removed with its source database
    Given I sign in as the relation template fixture publisher
    And the seeded relation cell resolves before publishing
    When I publish only the seeded source database as a template
    Then the source database and its relation target appear in the published pages list
    When I unpublish the source database from the published pages list
    Then the source database is removed from the published pages list
    And the automatically published relation target is removed from the published pages list
