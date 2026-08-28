Feature: Gallery readonly parity
  A linked Gallery inside a persisted locked document exercises the mounted App
  database readonly context without switching to the separate Publish renderer.

  Scenario: Locked Gallery hides add-row actions
    Given an editable Gallery database is open for readonly parity
    Then Gallery add-row actions are available before locking
    When I lock the mounted Gallery database
    Then the Gallery add row action is hidden in readonly mode
