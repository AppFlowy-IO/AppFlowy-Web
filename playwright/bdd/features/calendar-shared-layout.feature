@calendar_shared_layout
Feature: Shared calendar layout settings
  Calendar layout choices belong to the shared database view, so web and
  desktop clients can restore them and observe remote changes immediately.

  Scenario: Calendar layout changes synchronize without reopening the view
    Given two cloud browser sessions open the same shared calendar
    When the first calendar session chooses Week
    Then both calendar sessions show "Week" from the shared settings
    When the second calendar session chooses eight days
    Then both calendar sessions show "8 days" from the shared settings
    When the second session applies shared Day settings directly
    Then both calendar sessions show "Day" from the shared settings
    When the second session applies shared three-day settings directly
    Then both calendar sessions show "3 days" from the shared settings
    When the first calendar session chooses Month
    Then both calendar sessions show "Month" from the shared settings
    And the calendar keeps its date field and Monday week start
    When the second calendar session chooses eight days
    Then both calendar sessions show "8 days" from the shared settings
    And a fresh cloud session restores the shared eight-day layout
