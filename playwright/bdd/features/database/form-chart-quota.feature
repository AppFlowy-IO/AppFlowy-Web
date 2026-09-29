@cloud @database-view-creation
Feature: Database view creation crowns
  Hosted Free owners get one Form and one Chart. Exhausted allowances offer
  annual Pro checkout without creating a view or changing document content.

  Scenario: Independent allowances and upgrade actions across creation menus
    Given a Free hosted owner has a new grid for database creation
    Then the "tab" creation menu shows crowns for "Timeline"
    When the owner creates the first "Form" from the database tabs
    Then Cloud contains 1 Form and 0 Chart views
    And the "tab" creation menu shows crowns for "Form|Timeline"
    When the owner creates the first "Chart" from the database tabs
    Then Cloud contains 1 Form and 1 Chart views
    And the "tab" creation menu shows crowns for "Form|Chart|Timeline"

    When the owner selects exhausted "Form" from the "tab" creation menu
    Then annual Pro checkout has opened 1 time without another database view
    When the owner selects exhausted "Chart" from the "tab" creation menu
    Then annual Pro checkout has opened 2 times without another database view

    # Existing server inventory must be reflected on the first open after reload.
    When the owner reloads the database
    Then the "tab" creation menu shows crowns for "Form|Chart|Timeline"
    And the "sidebar" creation menu shows crowns for "Form|Chart|Timeline"
    When the owner selects exhausted "Chart" from the "sidebar" creation menu
    Then annual Pro checkout has opened 3 times without another database view

    # Both keyboard and pointer admission checks run before removing slash text.
    When the owner opens a new document for database creation
    And the owner selects the "chart" slash upgrade using "Enter"
    Then annual Pro checkout has opened 4 times without another database view
    When the owner selects the "linkedChart" slash upgrade using "click"
    Then annual Pro checkout has opened 5 times without another database view
    When the owner selects the "timeline" slash upgrade using "click"
    Then annual Pro checkout has opened 6 times without another database view
    When the owner selects the "linkedTimeline" slash upgrade using "Enter"
    Then annual Pro checkout has opened 7 times without another database view
