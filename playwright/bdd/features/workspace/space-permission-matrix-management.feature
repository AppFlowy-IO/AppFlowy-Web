@spm0622-management
Feature: Seeded space permission management
  Workspace owners can manage seeded space members from the Manage Space panel.

  Background:
    Given the seeded spm0622 space permission fixture exists

  Scenario: Owner grants and revokes a direct member on a new private space
    Given I sign in as seeded spm0622 "owner 1"
    When I create a temporary seeded spm0622 private space
    Then seeded spm0622 "member closed" cannot see the temporary private space
    When I sign in as seeded spm0622 "owner 1" and reopen the temporary private space Manage Space members tab
    Then the Manage Space members list does not show seeded spm0622 "member closed"
    And the Manage Space member search for seeded spm0622 "member closed" shows an addable workspace member
    When I add seeded spm0622 "member closed" to the current space
    Then the Manage Space members list shows seeded spm0622 "member closed" with role "Member"
    And seeded spm0622 "member closed" can see the temporary private space
    When I sign in as seeded spm0622 "owner 1" and reopen the temporary private space Manage Space members tab
    And I remove seeded spm0622 "member closed" from the current space
    Then the Manage Space members list does not show seeded spm0622 "member closed"
    And seeded spm0622 "member closed" cannot see the temporary private space

  Scenario: Owner manages seeded private space members
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

  Scenario: Owner downgrades private space members to view-only access
    Given I sign in as seeded spm0622 "owner 1"
    When I open the seeded spm0622 "private page"
    And I open the seeded spm0622 "private space" manage space panel
    And I change the Manage Space members default access to "Can edit"
    When I sign in as seeded spm0622 "member private" and open the seeded spm0622 "private page"
    Then the seeded spm0622 page title is editable
    When I sign in as seeded spm0622 "owner 1" and open the seeded spm0622 "private page"
    And I open the seeded spm0622 "private space" manage space panel
    And I change the Manage Space members default access to "Can view"
    When I sign in as seeded spm0622 "member private" and open the seeded spm0622 "private page"
    Then the seeded spm0622 page title is read-only
