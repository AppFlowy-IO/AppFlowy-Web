@database @permissions @issue-8958
Feature: Workspace members can open database row documents
  A database row document inherits its access from the database that owns the row.
  This must also work when the document exists without a legacy row-document registration.

  Scenario: An invited workspace member opens a row document in a public space
    Given an invited workspace member has default access to an issue 8958 public database
    And the issue 8958 database has a row document without a legacy permission registration
    When the invited member opens the issue 8958 database row
    Then the invited member can read and edit the issue 8958 row document

  Scenario: A private-space member opens a row document in a private space
    Given an invited workspace member has edit access to an issue 8958 private database
    And the issue 8958 database has a row document without a legacy permission registration
    When the invited member opens the issue 8958 database row
    Then the invited member can read and edit the issue 8958 row document
