@issue-1645
Feature: Published database row document
  A database row containing page content must open from a public published link.
  Published routes do not mount the authenticated AppProvider, so editor features
  used by the row document must tolerate the missing app-only event emitter.

  Scenario: Opening a published row document does not require AppProvider
    Given a public database snapshot contains a row document
    When I open the public database snapshot
    And I open the published database row
    Then the published row document opens without an AppProvider error
