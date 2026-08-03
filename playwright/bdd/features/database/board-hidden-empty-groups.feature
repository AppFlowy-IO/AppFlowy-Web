Feature: Board hidden empty groups
  Empty Board groups should be hidden by the shared view setting while remaining
  available in Hidden Groups for an explicit temporary show or hide action.

  Scenario: Hidden empty Board groups remain available after reopening
    Given a Board database is open for group behavior testing
    And an empty Board group named "BDD Reopened Empty Group" exists
    When I enable Hide empty groups for the Board
    And I navigate to another page and reopen the database
    Then Hide empty groups remains enabled for the Board
    And the Board has no visible column named "BDD Reopened Empty Group"
    When I expand the Board Hidden Groups section
    Then Hidden Groups has exactly one "BDD Reopened Empty Group" row with only a show action
    When I click the show action for hidden Board group "BDD Reopened Empty Group"
    Then the Board has exactly one visible empty column named "BDD Reopened Empty Group"
    And Hidden Groups has exactly one "BDD Reopened Empty Group" row with only a hide action
    When I click the hide action for shown Board group "BDD Reopened Empty Group"
    Then the Board has no visible column named "BDD Reopened Empty Group"
    And Hidden Groups has exactly one "BDD Reopened Empty Group" row with only a show action

  Scenario: Hidden Groups eye reflects rendered empty column visibility
    Given a Board database is open for group behavior testing
    And an empty Board group named "BDD Empty Group" exists
    When I enable Hide empty groups for the Board
    And I expand the Board Hidden Groups section
    Then the Board has no visible column named "BDD Empty Group"
    And Hidden Groups has exactly one "BDD Empty Group" row with only a show action
    When I click the show action for hidden Board group "BDD Empty Group"
    Then the Board has exactly one visible empty column named "BDD Empty Group"
    And Hidden Groups has exactly one "BDD Empty Group" row with only a hide action
    When I click the hide action for shown Board group "BDD Empty Group"
    Then the Board has no visible column named "BDD Empty Group"
    And Hidden Groups has exactly one "BDD Empty Group" row with only a show action
