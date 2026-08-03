@oidc-login
Feature: Signing in through a custom OIDC provider

  Unlike LDAP, which AppFlowy Cloud completes server-side, OIDC hands the
  browser to an external identity provider and finishes through a callback.
  That makes it testable here and nowhere else: the desktop app opens a real
  browser it cannot drive, so its suite stops at the authorize URL. Playwright
  *is* the browser, so it can follow the whole round trip.

  Providers are registered per deployment through the admin console. These
  scenarios select the seeded `custom:authentik` provider by default (or the
  `OIDC_TEST_PROVIDER` override) rather than creating one, because registering a
  provider from a test would overwrite a developer's setup.

  Test accounts live in the identity provider and are seeded by
  `just seed-auth-fixtures` in AppFlowy-Cloud-Premium; `just oidc-config` prints
  them along with the provider configuration.

  Background:
    Given a custom OIDC provider is configured

  Scenario: The provider is offered on the login page under its configured name
    When I open the login page
    Then the login page offers the configured OIDC provider

  # The handoff is the part AppFlowy owns: resolving the provider, building the
  # authorize URL and redirecting. What happens after belongs to the identity
  # provider.
  Scenario: Choosing the provider hands off to the identity provider
    When I open the login page
    And I continue with the configured OIDC provider
    Then the browser is handed to the identity provider

  Scenario: A directory user signs in through the provider
    When I open the login page
    And I continue with the configured OIDC provider
    And I authenticate at the identity provider as "scim.owner@example.com" with password "AppFlowy-SCIM-User-2026!"
    Then I am signed in to AppFlowy
