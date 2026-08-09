Feature: Published database templates
  A published database container can be reused without losing its sibling
  database views or row data.

  Scenario: Another account duplicates a database container with multiple views
    Given a publisher has a database container with Grid and Board views
    And the publisher adds identifiable row data
    When the publisher publishes the database container as a template
    And another account starts with the published template
    Then the duplicated database container has views "Grid, Board"
    And the duplicated database contains the publisher row data
