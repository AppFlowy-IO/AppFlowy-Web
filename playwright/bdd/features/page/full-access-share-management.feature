@full-access-share-management
Feature: FullAccess private page share panel controls
  The fa0522 FullAccess share-management fixture already exists in the local AppFlowy Cloud database.
  These scenarios verify the web share panel controls for owner, member, and guest users on private pages.

  Background:
    Given the seeded fa0522 full access share-management fixture exists

  # Expected result: the private-page owner can manage shares and grant Full access.
  Scenario: Owner sees share-management controls on a private page
    Given I sign in as full access seeded "owner"
    When I open the full access seeded "owner control private page"
    And I open the share panel
    Then the full access share panel shows seeded "owner" with "Full access"
    And the share panel general access is "Restricted"
    And the full access share panel can prepare an invite
    And the full access invite access selector offers "Full access"

  # Expected result: a workspace member with explicit FullAccess can manage sharing on the private page.
  Scenario: FullAccess member sees share-management controls on a private page
    Given I sign in as full access seeded "full access member"
    When I open the full access seeded "member full access private page"
    And I open the share panel
    Then the full access share panel shows seeded "owner" with "Full access"
    And the full access share panel shows seeded "full access member" with "Full access"
    And the share panel general access is "Restricted"
    And the full access share panel can prepare an invite
    And the full access invite access selector offers "Full access"

  # Expected result: a workspace member with edit access can open the share panel but cannot invite or grant access.
  Scenario: Edit member sees read-only share-management controls on a private page
    Given I sign in as full access seeded "edit member"
    When I open the full access seeded "member edit private page"
    And I open the share panel
    Then the full access share panel shows seeded "owner" with "Full access"
    And the full access share panel shows seeded "edit member" with "Can edit"
    And the full access share panel invite controls are read-only
    And the full access seeded "edit member" access menu only allows removing self

  # Expected result: a workspace guest with explicit FullAccess can manage sharing on the private page.
  Scenario: FullAccess guest sees share-management controls on a private page
    Given I sign in as full access seeded "full access guest"
    When I open the full access seeded "guest full access private page"
    And I open the share panel
    Then the full access share panel shows seeded "owner" with "Full access"
    And the full access share panel shows seeded "full access guest" with "Full access"
    And the share panel general access is "Restricted"
    And the full access share panel can prepare an invite
    And the full access invite access selector offers "Full access"

  # Expected result: guests without FullAccess can open explicitly shared private pages but cannot manage sharing.
  Scenario Outline: Non-FullAccess guests see read-only share-management controls
    Given I sign in as full access seeded "<account>"
    When I open the full access seeded "<page>"
    And I open the share panel
    Then the full access share panel shows seeded "owner" with "Full access"
    And the full access share panel shows seeded "<account>" with "<access>"
    And the full access share panel invite controls are read-only
    And the full access seeded "<account>" access menu only allows removing self

    Examples:
      | account    | page                         | access   |
      | edit guest | guest edit private page      | Can edit |
      | read guest | guest read only private page | Can view |

  # Expected result: a guest with Can view can open the private page but cannot change its title.
  Scenario: Read guest cannot edit a private page title
    Given I sign in as full access seeded "read guest"
    When I open the full access seeded "guest read only private page"
    Then the full access seeded page title is visible
    And the full access page title cannot be edited to "fa0522 Read Guest Rename Probe"

  # Expected result: a guest with Can edit can change the private page title.
  Scenario: Edit guest can edit a private page title
    Given I sign in as full access seeded "edit guest"
    When I open the full access seeded "guest edit private page"
    Then the full access seeded page title is visible
    And the full access page title is editable
    When I rename the full access page title to "fa0522 Edit Guest Rename Probe"
    Then the full access page title is "fa0522 Edit Guest Rename Probe"

  # Expected result: a workspace guest without an explicit page share cannot open the owner's private page.
  Scenario: Unshared guest cannot open a private page
    Given I sign in as full access seeded "no share guest"
    When I open the full access seeded "owner control private page"
    Then the full access seeded "owner control private page" is not opened
