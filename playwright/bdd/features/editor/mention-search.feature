@mention-search
Feature: Mention panel search
  The Web mention panel should exercise the same server mention API behavior through the editor UI.

  Background:
    Given the mention search fixture owner is signed in
    And the mention search fixture member can be mentioned

  Scenario: Empty mention query shows defaults without links or database rows
    Given a blank mention search document page is open
    When I open the mention panel with an empty query
    Then the mention panel shows date quick picks
    And the mention panel does not show a links section
    And the mention panel does not show database rows

  # Opt-in (RUN_CLOUD_MENTION_STREAM_HEADERS=1): with Web and the API on different origins, as in
  # CI, the Cloud nginx.conf must allow x-request-time and x-request-stream-id in CORS preflights.
  @cloud-mention-stream-headers
  Scenario: Mention requests carry per-lane stream headers
    Given a blank mention search document page is open
    And mention search requests are recorded
    When I search mentions for "example.com"
    Then the typed mention requests for "example.com" were answered on two streams of one session
    And the empty mention request was answered on the bare stream of that session without database rows

  Scenario: Typed mention query filters fixture people
    Given a blank mention search document page is open
    When I search mentions for the fixture member
    Then the mention panel shows the fixture member

  Scenario: Typed URL-like mention query shows an external link
    Given a blank mention search document page is open
    When I search mentions for "example.com"
    Then the mention panel shows an external link for "example.com"

  Scenario: Database-row retry-later keeps primary mention results visible
    Given a blank mention search document page is open
    And database-row mention search retries later for "example.com"
    When I search mentions for "example.com"
    Then the mention panel shows an external link for "example.com"
    And the mention panel does not show database rows

  Scenario: Typed mention query searches embedded database rows
    Given a mention search document contains an indexed fixture database row
    When I search mentions for the fixture database row
    Then the browser sent a database-row mention search request
    And the mention panel shows the fixture database row

  # MEN-WEB-08, behind the picker's mentionTypeaheadV2 switch (localStorage, off by default).
  Scenario: Typing narrows the recent pages at once while typed mention searches are slow
    Given a blank mention search document page is open
    And mention search answers the empty query with two recent fixture pages
    And typed mention searches are held for 1500 ms
    And the mention typeahead v2 is switched on
    When I open the mention panel with an empty query
    Then the mention panel shows both recent fixture pages
    When I type the first letters of the first recent fixture page
    Then the mention panel shows only the first recent fixture page while typed searches are held

  # MEN-WEB-09, behind the same switch: the local lane lists a page this tab created a moment ago,
  # which no answer holds yet. The bare answer is stubbed empty, so only the local lane can list it.
  Scenario: A page created seconds ago is found at once while typed mention searches are slow
    Given a blank mention search document page is open
    And a fresh fixture page was created and renamed in this tab
    And mention search answers the empty query with no pages
    And typed mention searches are held for 1500 ms
    And the mention typeahead v2 is switched on
    When I search mentions for the first letters of the fresh fixture page
    Then the mention panel shows the fresh fixture page, flagged fresh, while typed searches are held

  # MEN-WEB-12, behind the picker's sections switch (localStorage, off by default). The typed
  # answer is stubbed with its sections out of order, so only the picker decides what shows where.
  Scenario: Typed mention sections keep the canonical order with the sections switch on
    Given a blank mention search document page is open
    And mention search answers the sections fixture query with the member, five pages and a database
    And the mention sections switch is on
    When I search mentions for the sections fixture query
    Then the mention panel shows the people, pages and databases sections in that order
    And the mention panel lists the fixture database in its own section beside four pages and "1 more"
    And the mention panel offers to create a page named after the query last
