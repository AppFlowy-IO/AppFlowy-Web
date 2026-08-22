@spm0622-management @mode:serial
Feature: Seeded space permission management
  Workspace owners can manage seeded space members from the Manage Space panel, and
  seeded users receive the access configured by the server-side permission matrix.

  Background:
    Given the seeded spm0622 space permission fixture exists

  Scenario Outline: Seeded users receive the configured space and page access
    Given I sign in as seeded spm0622 "<account>"
    When I directly open the seeded spm0622 "<page>"
    Then the seeded spm0622 "<space>" space navigation is "<navigation>"
    And the directly opened seeded spm0622 page is "<page access>"

    Examples: Default space
      | account        | space         | page         | navigation | page access |
      | owner 1        | default space | default page | visible    | editable    |
      | owner 2        | default space | default page | visible    | editable    |
      | member default | default space | default page | visible    | editable    |
      | member private | default space | default page | visible    | editable    |
      | guest none     | default space | default page | hidden     | denied      |

    Examples: Private space
      | account        | space         | page         | navigation | page access |
      | owner 2        | private space | private page | visible    | editable    |
      | member default | private space | private page | visible    | read-only   |
      | member private | private space | private page | visible    | editable    |
      | member closed  | private space | private page | hidden     | denied      |
      | guest private  | private space | private page | hidden     | editable    |
      | guest none     | private space | private page | hidden     | denied      |

    Examples: Group Full Access space
      | account        | space                   | page                   | navigation | page access |
      | member default | group full access space | group full access page | visible    | editable    |
      | member open    | group full access space | group full access page | visible    | editable    |
      | member closed  | group full access space | group full access page | hidden     | denied      |

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
    And seeded spm0622 "member closed" can use the temporary private page
    When I sign in as seeded spm0622 "owner 1" and reopen the temporary private space Manage Space members tab
    And I remove seeded spm0622 "member closed" from the current space
    Then the Manage Space members list does not show seeded spm0622 "member closed"
    And seeded spm0622 "member closed" cannot see the temporary private space
    And seeded spm0622 "member closed" receives no access to the temporary private page

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

  # The seeded member has an explicit manual Can edit grant. Space defaults apply
  # to default/joined membership and must not overwrite that explicit grant.
  Scenario: Owner changes private space defaults without clobbering explicit member access
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
    Then the seeded spm0622 page title is editable

  Scenario: Owner can inspect and update the seeded workspace group
    Given I sign in as seeded spm0622 "owner 1"
    When I open the People settings groups tab
    Then the workspace groups list shows "spm0622 Full Access Space Group" with "2 members"
    When I open workspace group "spm0622 Full Access Space Group"
    Then the group detail panel shows workspace member "spm0622-member-default@appflowy.local"
    And the group detail panel shows workspace member "spm0622-member-open@appflowy.local"
    And the group detail panel does not show workspace member "spm0622-member-closed@appflowy.local"
    And the group detail member search for "spm0622-member-closed@appflowy.local" shows an addable workspace member
    When I add workspace member "spm0622-member-closed@appflowy.local" to the open group
    Then the group detail panel shows workspace member "spm0622-member-closed@appflowy.local"
    When I remove workspace member "spm0622-member-closed@appflowy.local" from the open group
    Then the group detail panel does not show workspace member "spm0622-member-closed@appflowy.local"

  Scenario: Seeded group membership grants and revokes Full Access to its private space
    Given I sign in as seeded spm0622 "owner 1"
    Then seeded spm0622 "member closed" cannot open the seeded group Full Access page
    When I return as seeded spm0622 "owner 1" without resetting group membership
    And I open the People settings groups tab
    And I open workspace group "spm0622 Full Access Space Group"
    And I add workspace member "spm0622-member-closed@appflowy.local" to the open group
    Then the group detail panel shows workspace member "spm0622-member-closed@appflowy.local"
    And seeded spm0622 "member closed" can manage the seeded group Full Access page
    When I return as seeded spm0622 "owner 1" without resetting group membership
    And I open the People settings groups tab
    And I open workspace group "spm0622 Full Access Space Group"
    And I remove workspace member "spm0622-member-closed@appflowy.local" from the open group
    Then the group detail panel does not show workspace member "spm0622-member-closed@appflowy.local"
    And seeded spm0622 "member closed" cannot open the seeded group Full Access page

  Scenario: Seeded group Can edit access is enforced and revoked
    Given I sign in as seeded spm0622 "owner 1"
    When I prepare the seeded private page and workspace group for sharing
    Then seeded spm0622 "member open" cannot open the seeded group-share page
    When I sign in as seeded spm0622 "owner 1" and open the seeded group-share page as owner
    And I open the share panel
    And I search the share invite input for the seeded workspace group
    Then the share invite suggestions show the seeded workspace group
    When I tag the seeded workspace group in the share invite input
    And I set the share panel invitation access to "Can edit"
    And I send the share panel invites
    Then the share panel shows the seeded workspace group with "Can edit"
    When I sign in as seeded spm0622 "member open" and open the seeded group-share page
    And I open the share panel
    Then the seeded group-share page is editable but share controls are read only
    When I sign in as seeded spm0622 "owner 1" and open the seeded group-share page as owner
    And I open the share panel
    And I remove the seeded workspace group access from the share panel
    Then the seeded workspace group is not shown in the share panel
    And seeded spm0622 "member open" cannot open the seeded group-share page
