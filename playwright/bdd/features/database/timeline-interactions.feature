@timeline @timeline-interactions
Feature: Timeline scheduling and interaction
  A Timeline is another view of the same database rows.
  Pointer and keyboard gestures must update real date cells, preserve unrelated
  values, form one undo action, and survive opening a fresh document instance.

  Background:
    Given an editable Timeline with Alpha and Beta scheduled and Gamma without dates

  @drag @persistence
  Scenario Outline: Moving a bar preserves its inclusive duration
    When I drag the Alpha Timeline bar by <days> calendar days
    Then Alpha's start and end dates both shift by <days> calendar days
    And the other Timeline rows and the date reminder are unchanged
    And one Timeline undo and redo restores both endpoints together
    And the Timeline dates survive reload

    Examples:
      | days |
      | 2    |
      | -2   |

  @resize
  Scenario Outline: Resizing one endpoint clamps at a single inclusive day
    When I resize the Alpha Timeline <handle> handle by <days> calendar days
    Then Alpha's start shifts by <start> days and its end shifts by <end> days
    And the other Timeline rows and the date reminder are unchanged
    And one Timeline undo and redo restores both endpoints together

    Examples:
      | handle | days | start | end |
      | start  | -2   | -2    | 0   |
      | start  | 1    | 1     | 0   |
      | start  | 8    | 2     | 0   |
      | end    | 3    | 0     | 3   |
      | end    | -1   | 0     | -1  |
      | end    | -8   | 0     | -2  |

  @keyboard
  Scenario Outline: Keyboard controls edit dates without opening row details
    When I press <shortcut> on the Alpha Timeline <target>
    Then Alpha's start shifts by <start> days and its end shifts by <end> days
    And no Timeline row detail is open

    Examples:
      | shortcut              | target       | start | end |
      | Alt+ArrowRight        | bar          | 1     | 1   |
      | Alt+ArrowLeft         | bar          | -1    | -1  |
      | Alt+Shift+ArrowRight  | bar          | 0     | 1   |
      | ArrowLeft             | start handle | -1    | 0   |
      | ArrowLeft             | end handle   | 0     | -1  |

  @drag
  Scenario: Moving a single date does not invent an end date
    Given Alpha has a single all-day date
    When I drag the Alpha Timeline bar by 2 calendar days
    Then Alpha's single date shifts by 2 days and remains a single date

  @drag @time
  Scenario: Hour-scale dragging snaps timed ranges to fifteen minutes
    Given Alpha has a timed range from 09:00 to 11:00 today on the Hour scale
    When I drag the timed Alpha bar by 17 pixels
    Then both Alpha times move by 15 minutes and time display stays enabled

  @cancel
  Scenario Outline: Cancelling an in-progress drag commits nothing
    When I drag Alpha for three days and cancel with <event>
    Then all Timeline date values remain unchanged with no undo action
    And no Timeline row detail is open

    Examples:
      | event         |
      | Escape        |
      | pointercancel |

  @drag @scroll
  Scenario: Holding a dragged bar at the viewport edge scrolls the dates
    When I hold the Alpha bar at the right edge until the Timeline auto-scrolls
    Then the committed Alpha range includes the auto-scrolled days
    And one Timeline undo and redo restores both endpoints together

  @row-detail
  Scenario Outline: Opening an existing row does not reschedule it
    When I open Alpha from its Timeline <target>
    Then the row detail shows Alpha and can rename it to Alpha revised
    And Alpha's dates remain unchanged

    Examples:
      | target |
      | bar    |
      | table  |

  @schedule
  Scenario: Search and schedule an existing undated row
    When I search the Timeline no-date list for Gamma and schedule it
    Then Gamma has a three-day all-day range and leaves the no-date list
    And scheduling Gamma can be undone and redone

  @schedule
  Scenario: Double-clicking an empty track schedules its existing row
    When I double-click Gamma's empty Timeline track five days after today
    Then Gamma is scheduled five days after today with a three-day inclusive range

  @create
  Scenario: New creates a scheduled database row and opens its details
    When I create a Timeline row named Delta with the New button
    Then Delta exists once in the database with a three-day inclusive date range
    And the Timeline dates survive reload

  @reorder
  Scenario: Dragging a table row reorders rows without changing dates
    When I drag the Gamma table row before Alpha
    Then the Timeline row order is Gamma Alpha Beta and the dates are unchanged
    And the reordered Timeline rows survive reload

  @navigation @settings
  Scenario: All zoom levels and date navigation preserve row data
    When I visit every Timeline zoom level and navigate previous next and Today
    Then all Timeline date values remain unchanged
    And the selected Timeline zoom survives reload

  @settings @persistence
  Scenario: The table and bars have independent property visibility
    When I show the Date table property and the Phase bar property
    And I widen the Timeline title column by 80 pixels
    Then the Timeline shows those properties in their chosen locations
    And the Timeline table settings survive reload and hiding the table

  @grouping
  Scenario: Grouped rows collapse and prevent ambiguous manual reordering
    When I group the Timeline by Phase
    Then the Ready and No Phase groups contain the correct rows
    And grouped Timeline rows cannot be manually reordered
    When I collapse and reopen the Ready Timeline group
    Then Alpha's dates remain unchanged

  @search
  Scenario: Search filters Timeline rows and clearing it restores them
    When I search the Timeline for Beta
    Then only Beta is visible in the Timeline
    When I clear the Timeline search
    Then Alpha Beta and Gamma are visible with unchanged dates

  @date-properties
  Scenario: Separate start and end fields move and undo atomically
    Given the Timeline uses separate Start and Finish date properties
    When I drag the Alpha Timeline bar by 2 calendar days
    Then both separate date fields shift by two days in one undo action
    And the separate Timeline date configuration survives reload

  @date-properties
  Scenario: Invalid ranges remain repairable without silently changing dates
    Given Alpha's end date is before its start date
    Then Alpha shows an invalid-range message instead of a draggable bar
    And Alpha cannot be scheduled from the no-date list until its dates are repaired
    And all Timeline date values remain unchanged

  @navigation
  Scenario Outline: An offscreen range can be brought into view
    Given Alpha is scheduled <days> days from today
    When I use Alpha's Jump to dates control
    Then the Alpha bar is inside the visible Timeline calendar
    And Alpha's dates remain unchanged

    Examples:
      | days |
      | -50  |
      | 50   |

  @filter @sort
  Scenario: Filters and sorts use the shared database controls
    When I filter the Timeline Name to contain Beta
    Then only Beta is visible in the Timeline
    When I remove the Timeline filter and sort Name descending
    Then the visible Timeline order is Gamma Beta Alpha with no reorder handles
    And all Timeline date values remain unchanged

  @date-properties
  Scenario: A generated date property allows viewing but no scheduling gestures
    When I choose Created time as the Timeline date property
    Then generated Timeline dates have no resize or scheduling controls
    And dragging or using edit shortcuts cannot change generated dates

  @date-properties
  Scenario: Removing the selected date property offers a recoverable empty state
    Given the selected Timeline date property is removed
    When I add a replacement date property from the Timeline empty state
    Then the Timeline has a valid editable date property again

  @collaboration
  Scenario: Date edits synchronize to another mounted Timeline
    Given the same Timeline is open in a second browser tab
    When I drag the Alpha Timeline bar by 2 calendar days
    Then the second Timeline receives the exact committed dates
    When I move Alpha one more day using the second Timeline's keyboard
    Then the first Timeline receives the second tab's dates

  @collaboration @cancel
  Scenario: A stale drop cannot overwrite a collaborator's date edit
    Given the same Timeline is open in a second browser tab
    When a collaborator moves Alpha while my three-day drag is in progress
    Then my stale drop is rejected and both tabs keep the collaborator's dates
