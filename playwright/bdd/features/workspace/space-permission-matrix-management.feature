@spm0622-management
Feature: Seeded space permission management
  Workspace owners can manage seeded space members from the Manage Space panel.

  Background:
    Given the seeded spm0622 space permission fixture exists

  Scenario: Owner adds and removes a direct member from the seeded private space
    Given I sign in as seeded spm0622 "owner 1"
    When I open the seeded spm0622 "private page"
    And I open the seeded spm0622 "private space" manage space panel
    And I open the Manage Space members tab
    Then the Manage Space members list shows seeded spm0622 "owner 2" with role "Owner"
    And the Manage Space members list shows seeded spm0622 "member default" with role "Member"
    And the Manage Space members list shows seeded spm0622 "member private" with role "Member"
    And the Manage Space members list shows seeded spm0622 "guest private" with role "Member"
    And the Manage Space members list does not show seeded spm0622 "member closed"
    And the Manage Space member search for seeded spm0622 "member closed" shows an addable workspace member
    When I add seeded spm0622 "member closed" to the current space
    Then the Manage Space members list shows seeded spm0622 "member closed" with role "Member"
    When I remove seeded spm0622 "member closed" from the current space
    Then the Manage Space members list does not show seeded spm0622 "member closed"
