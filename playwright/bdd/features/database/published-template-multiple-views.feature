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

  Scenario: Another account duplicates a published database child view with multiple views
    Given a publisher has a database container with a custom view order
    And the publisher adds identifiable row data
    When the publisher publishes the Board database view as a template
    Then the published child-view outline keeps the database view order
    When another account opens the published template
    Then the published database views keep the publisher order
    When that account starts with the published template
    Then the duplicated database views keep the publisher order
    And the duplicated database contains the publisher row data
    When the publisher unpublishes the published database child view
    Then the published outline no longer contains the source database
    And the former database child public link is unavailable

  Scenario: Published database outline navigates and highlights database views
    Given a publisher has a database container with a custom view order
    When the publisher publishes the Board database view as a template
    Then the published child-view outline keeps the database view order
    When another account opens the published template
    Then the published database views keep the publisher order
    And the public outline shows the database container and dot-style child views
    When the public outline opens the "Calendar" database view
    Then the public database route keeps its published anchor and selects "Calendar"
    And the public outline highlights only the container and active database view
    When the public outline opens the database container
    Then the public database route keeps its published anchor and selects "Grid"
    And the public outline highlights only the container and active database view
    And the public outline remains expanded
