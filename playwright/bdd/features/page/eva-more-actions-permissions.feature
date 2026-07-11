@eva-more-actions-permissions
Feature: Eva page action permissions
  The Eva permission fixture already exists in the local AppFlowy Cloud database.
  These scenarios verify page action menus for Full access, Can edit, and Can view pages.

  Background:
    Given the seeded Eva page action permission fixture exists

  Scenario: Eva sees permission-specific sidebar more actions
    Given I sign in as seeded Eva
    When I open Eva's sidebar more menu for "Grante full access for eva"
    Then Eva's sidebar more menu shows only "Rename, Change icon, Lock page, Duplicate, Move to, Delete, Open in a new tab"
    When I close Eva's sidebar more menu
    And I open Eva's sidebar more menu for "Edit only permission for eva"
    Then Eva's sidebar more menu shows only "Duplicate, Open in a new tab"
    When I close Eva's sidebar more menu
    And I open Eva's sidebar more menu for "Read only permission for eva"
    Then Eva's sidebar more menu shows only "Open in a new tab"

  Scenario: Eva sees permission-specific page more actions
    Given I sign in as seeded Eva
    When I open Eva's page "Grante full access for eva"
    And I open Eva's page more menu
    Then Eva's page more menu shows only "Lock page, Duplicate, Move to, Find and replace, Delete, Version history"
    When I close Eva's page more menu
    And I open Eva's page "Edit only permission for eva"
    And I open Eva's page more menu
    Then Eva's page more menu shows only "Duplicate, Find and replace, Version history"
    When I close Eva's page more menu
    And I open Eva's page "Read only permission for eva"
    And I open Eva's page more menu
    Then Eva's page more menu shows only "Find and replace"

  Scenario: Eva does not see workspace creation from a selected-space more menu
    Given I sign in as seeded Eva
    When I open Eva's space more menu for "Annie space"
    Then Eva's space more menu shows only "Duplicate Space"
