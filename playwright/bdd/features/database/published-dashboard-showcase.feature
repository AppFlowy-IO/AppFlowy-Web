@dashboard-publish-fixture
Feature: Publish saved dashboards with multiple database sources
  Publishing the selected dashboard includes every widget's source database.
  Anonymous visitors see the saved data without first opening those databases as the owner.

  Scenario Outline: Every source is visible after publishing the saved dashboard
    Given the saved "<dashboard>" dashboard is ready to publish in Pro workspace
    When the owner publishes the selected saved dashboard through Share
    And an anonymous visitor opens the published dashboard
    Then every saved dashboard widget shows its expected source data
    When the anonymous visitor reloads the published dashboard
    Then every saved dashboard widget shows its expected source data
    When the anonymous visitor opens the published database container and selects the saved dashboard
    Then every saved dashboard widget shows its expected source data

    Examples:
      | dashboard  |
      | agency-hub |
      | full-house |
