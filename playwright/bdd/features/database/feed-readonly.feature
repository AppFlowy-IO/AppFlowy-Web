Feature: Feed readonly parity
  A linked Feed inside a persisted locked document exercises the mounted App
  database readonly context without switching to the separate Publish renderer.

  Scenario: Locked Feed hides mutations
    Given an editable Feed database is open for readonly parity
    Then Feed mutation controls are available before locking
    When I lock the mounted Feed database
    Then feed controls are readonly
