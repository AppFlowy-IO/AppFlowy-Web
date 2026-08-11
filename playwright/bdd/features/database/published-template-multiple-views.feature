Feature: Published database templates
  A published database container can be reused without losing its sibling
  database views, their order, or row data.

  Scenario: Another account duplicates a database container with multiple views
    Given a publisher has a database container with a custom view order
    And the publisher adds identifiable row data
    When the publisher publishes the database container as a template
    And another account opens the published template
    Then the published database views keep the publisher order
    When that account starts with the published template
    Then the duplicated database views keep the publisher order
    And the duplicated database contains the publisher row data
