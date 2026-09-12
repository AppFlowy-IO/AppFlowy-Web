@calendar-placeholder @cloud
Feature: Calendar cards stay local until the user keeps them
  Clicking an empty calendar slot opens a local placeholder. Closing an
  untouched placeholder must not insert a database row, including in cloud sync.

  Scenario: Only committed month and week placeholders survive a fresh cloud login
    Given a new cloud calendar is open for placeholder creation
    When I click an empty day in the placeholder calendar
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder with Escape
    Then the calendar has no placeholder and 0 additional stored rows
    When I click an empty day in the placeholder calendar
    And I dismiss the calendar placeholder by clicking outside
    Then the calendar has no placeholder and 0 additional stored rows

    When I switch the placeholder calendar to "Week"
    And I click the empty placeholder calendar slot at 9 hours
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder with Escape
    Then the calendar has no placeholder and 0 additional stored rows
    When I click the empty placeholder calendar slot at 9 hours
    And I dismiss the calendar placeholder by clicking outside
    Then the calendar has no placeholder and 0 additional stored rows

    When I click the empty placeholder calendar slot at 9 hours
    And I name the calendar placeholder "Cloud timed card"
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder with Escape
    Then the calendar stores exactly one new card named "Cloud timed card" with its selected dates
    And the calendar has no placeholder and 1 additional stored rows

    When I switch the placeholder calendar to "Month"
    And I click an empty day in the placeholder calendar
    And I name the calendar placeholder "Cloud all-day card"
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder by clicking outside
    Then the calendar stores exactly one new card named "Cloud all-day card" with its selected dates
    And the calendar has no placeholder and 2 additional stored rows

    When I click an empty day in the placeholder calendar
    And I explicitly submit the calendar placeholder
    Then the calendar stores exactly one new card named "" with its selected dates
    And the calendar has no placeholder and 3 additional stored rows
    And only the committed calendar cards return in a fresh cloud browser session

  Scenario: A property-only edit can save an unscheduled card and release the placeholder
    Given a new cloud calendar is open for placeholder creation
    When I click an empty day in the placeholder calendar
    And I clear the calendar placeholder date
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder with Escape
    Then the calendar stores exactly one new unscheduled card
    And the calendar has no placeholder and 1 additional stored rows
    When I click an empty day in the placeholder calendar
    Then the calendar shows one local placeholder and no additional stored rows
    When I dismiss the calendar placeholder with Escape
    Then the calendar has no placeholder and 1 additional stored rows
