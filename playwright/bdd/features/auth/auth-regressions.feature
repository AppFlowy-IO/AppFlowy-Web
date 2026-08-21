Feature: Authentication regression safeguards
  Authentication must keep navigation on the trusted app origin and avoid advancing or repeating requests when an operation is still pending.

  Scenario: Backslash authority redirect falls back to the app
    Given mocked AppFlowy auth APIs are configured for "password" sign in
    When I complete password sign in with a backslash authority redirect
    Then I am redirected to the safe app fallback on the configured origin

  Scenario: Failed password recovery stays on the reset form
    Given the password recovery API will fail
    When I submit a password recovery request
    Then password recovery stays on the form and does not show success

  Scenario: Rapid password submission sends one request
    Given mocked AppFlowy auth APIs are configured for "password" sign in
    And the password sign-in API responds slowly
    When I rapidly submit password sign in twice
    Then exactly one password sign-in request is sent
