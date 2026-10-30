@html-document-import
Feature: Import a saved HTML web page
  HTML imports use browser parsing, real page persistence and the editor.
  A saved page's scripts must not execute, and its content must remain readable after reload.

  Scenario: Import a saved web page with a large script and reopen it from the sidebar
    Given I am signed in for document file import
    When I import the saved HTML web page through the import dialog
    Then the HTML import completes and opens its page
    And the saved HTML article is rendered without executing its scripts
    When I reload and reopen the HTML import from the sidebar
    Then the saved HTML article is rendered without executing its scripts
