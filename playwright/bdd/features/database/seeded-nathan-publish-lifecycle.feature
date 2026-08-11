@seeded-nathan-publish @mode:serial
Feature: Nathan account database publish lifecycle
  The stateful fixture account creates a temporary database so publishing can
  be tested against an established workspace without changing its saved pages.

  Scenario: Publishing and unpublishing a multi-view database updates every view
    Given the Nathan publish account has a temporary database container with a custom view order
    And the publisher adds identifiable row data
    When the publisher publishes the database container as a template
    And I open the temporary database public link in a fresh browser
    Then the published database views keep the publisher order
    And the published outline contains the temporary container and all its views in source order
    When I unpublish the temporary database container from published pages
    Then the published outline no longer contains the temporary container or its views
    And the temporary database's former public link is unavailable
