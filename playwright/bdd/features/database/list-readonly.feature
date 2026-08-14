Feature: List readonly parity
  A linked List inside a persisted locked document exercises the mounted App
  database readonly context without switching to the separate Publish renderer.

  Scenario: Locked List hides mutations and keeps row detail readonly
    Given an editable List database is open for readonly parity
    Then List mutation controls are available before locking
    When I lock the mounted List database
    Then the List add row action is hidden in readonly mode
    And List row mutations and inline cell editing are disabled
    When I open the first List row detail while readonly
    Then the List row detail remains open and readonly
