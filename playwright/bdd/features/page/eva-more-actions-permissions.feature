@eva-more-actions-permissions @mode:serial
Feature: Eva page action permissions
  These scenarios create an isolated Custom space for Eva and verify page action menus
  for Full access, Can edit, and Can view pages.

  Background:
    Given a temporary Eva page action permission fixture exists

  Scenario: Eva sees permission-specific sidebar more actions
    Given I sign in as seeded Eva
    When I open Eva's sidebar more menu for "Grante full access for eva"
    Then Eva's sidebar more menu shows only "Rename, Change icon, Lock page, Duplicate, Move to, Delete, Open in a new tab"
    When I close Eva's sidebar more menu
    And I open Eva's sidebar more menu for "Edit only permission for eva"
    Then Eva's sidebar more menu shows only "Rename, Change icon, Lock page, Duplicate, Open in a new tab"
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
    Then Eva's page more menu shows only "Lock page, Duplicate, Find and replace, Version history"
    When I close Eva's page more menu
    And I open Eva's page "Read only permission for eva"
    And I open Eva's page more menu
    Then Eva's page more menu shows only "Find and replace"

  Scenario: A space member sees neither Manage Space nor Duplicate Space
    Given I sign in as seeded Eva
    When I inspect Eva's temporary permission space actions
    Then Eva's temporary permission space more actions button is hidden
