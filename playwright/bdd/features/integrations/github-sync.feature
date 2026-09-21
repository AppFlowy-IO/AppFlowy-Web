@github-sync-live @mode:serial
Feature: Import public GitHub documentation through Connections
  A workspace owner configures the repository and destination space in Connections.
  Cloud and Worker fetch GitHub and persist the pages without a GitHub OAuth account.

  Scenario: Public documentation survives closing the wizard and remains read-only
    Given the configured GitHub sync owner opens the unbound destination workspace
    When the owner opens Add connection and selects GitHub
    And the owner configures the commercial repository and destination through the dialog
    Then the configured commercial documentation source needs no GitHub account
    When the owner reviews the source and starts GitHub sync
    And the owner closes and reopens the durable GitHub sync
    Then GitHub sync completes with actual persisted pages in the configured space
    And every imported document and image matches its pinned GitHub source
    And the unrelated manual page remains unchanged and unmanaged
    When the owner views the space and opens an imported document
    Then the imported document shows its GitHub source and is read-only
    And no GitHub authorization or duplicate binding creation occurred
