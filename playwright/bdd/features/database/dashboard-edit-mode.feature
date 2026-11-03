@dashboard @cloud
Feature: Dashboard Edit mode follows the editor, not the connection
  Edit mode is a local choice that is never saved. A new or empty dashboard
  opens in Edit mode for editors, and a dashboard with widgets opens in View
  mode. Losing write access for a moment hides the editing controls; they
  come back with the access unless the editor pressed Done.

  Scenario: A new dashboard opens in Edit mode
    Given the "Projects" database is open
    When I add a dashboard view to the "Projects" database
    Then the dashboard is in Edit mode

  Scenario: A dashboard with widgets opens in View mode
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I reopen the dashboard
    Then the dashboard is in View mode

  Scenario: An empty dashboard enters Edit mode when write access arrives after it opened
    Given an empty dashboard of "Projects" is open while my write access is not confirmed yet
    Then the dashboard is in View mode
    And the dashboard offers no Edit button
    When my write access to the dashboard is confirmed
    Then the dashboard is in Edit mode

  Scenario: Edit mode comes back after a brief loss of write access
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the dashboard Edit button
    And my write access to the dashboard is lost
    Then the dashboard is in View mode
    And the dashboard offers no Edit button
    When my write access to the dashboard is restored
    Then the dashboard is in Edit mode
    And the dashboard shows width handles

  Scenario: Done stays done after a brief loss of write access
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the dashboard Edit button
    And I click the dashboard Done button
    And my write access to the dashboard is lost
    And my write access to the dashboard is restored
    Then the dashboard is in View mode

  Scenario: Edit mode survives switching to another view tab and back
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the dashboard Edit button
    And I open the "Grid" view tab of "Projects"
    And I open the dashboard view tab
    Then the dashboard is in Edit mode

  Scenario: Widgets added elsewhere end the automatic Edit mode of an empty dashboard
    Given an empty dashboard of "Projects" is open
    Then the dashboard is in Edit mode
    When a collaborator adds the "Grid" view of "Projects" to the dashboard
    Then the dashboard is in View mode
    And the dashboard has 1 widget

  # Web only: a narrow desktop browser is a mobile context; a narrow desktop
  # app window is not (covered there by dashboard_bloc_test).
  @web-only
  Scenario: A narrow browser window hides editing and a wide one brings it back
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the dashboard Edit button
    And the browser window is 700 px wide
    Then the dashboard is in View mode
    And the dashboard offers no Edit button
    When the browser window is 1440 px wide
    Then the dashboard is in Edit mode
