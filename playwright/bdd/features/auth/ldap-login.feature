@ldap-login
Feature: Signing in against an LDAP directory
  AppFlowy Cloud verifies LDAP credentials server-side: it binds with a service
  account, searches for the user, then binds again as that user to check the
  password. Only then does it provision an AppFlowy account and mint a session.

  The directory is seeded by `just seed-auth-fixtures` in AppFlowy-Cloud-Premium
  and holds three accounts, each covering a different outcome:

    | uid    | mail                   | password        |
    | alice  | alice.ldap@example.com | alice-secret-pw |
    | bob    | bob.ldap@example.com   | bob-secret-pw   |
    | nomail | (none)                 | nomail-pw       |

  Note the username is the directory `uid`, not an email address, because the
  connection's filter is `(uid={{username}})`.

  Scenario: A directory user signs in and is provisioned into the workspace
    Given an LDAP connection is configured for the workspace
    When I sign in with LDAP username "alice" and password "alice-secret-pw"
    Then the LDAP sign-in succeeds
    And the session belongs to "alice.ldap@example.com"

  Scenario: A second directory user signs in independently
    Given an LDAP connection is configured for the workspace
    When I sign in with LDAP username "bob" and password "bob-secret-pw"
    Then the LDAP sign-in succeeds
    And the session belongs to "bob.ldap@example.com"

  # nomail binds successfully against the directory — the password is correct.
  # It is AppFlowy that refuses it, because accounts are keyed on email and the
  # entry has no `mail` attribute for the configured email_attr to read.
  Scenario: A directory user with no email attribute cannot sign in
    Given an LDAP connection is configured for the workspace
    When I sign in with LDAP username "nomail" and password "nomail-pw"
    Then the LDAP sign-in is rejected

  Scenario: A wrong password is rejected
    Given an LDAP connection is configured for the workspace
    When I sign in with LDAP username "alice" and password "not-her-password"
    Then the LDAP sign-in is rejected

  Scenario: An unknown username is rejected
    Given an LDAP connection is configured for the workspace
    When I sign in with LDAP username "ghost" and password "whatever"
    Then the LDAP sign-in is rejected

  # The security property worth protecting: a misconfigured entry, a wrong
  # password and a non-existent user must be indistinguishable to the caller,
  # or the endpoint becomes a way to enumerate the directory.
  Scenario: Every rejection looks identical to the caller
    Given an LDAP connection is configured for the workspace
    When I collect the rejection for each of these sign-ins
      | username | password         |
      | nomail   | nomail-pw        |
      | alice    | not-her-password |
      | ghost    | whatever         |
    Then every rejection reports the same message
