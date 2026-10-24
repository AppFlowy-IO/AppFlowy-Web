@relative-date-comparisons
Feature: Rolling date comparisons in a real database
  A comparison such as Before Today keeps its relative operand when saved to
  Cloud, reopened, edited in advanced filters, and evaluated on the next day.

  Scenario: Relative comparisons filter real rows and survive a fresh Cloud open
    Given a real Grid with Yesterday, Today, and Tomorrow tasks
    When I filter Due Date with "Before" "Today"
    Then the relative-date grid shows exactly "Yesterday task"
    And the saved date comparison is "Before" "Today"
    And a fresh browser reads the same date comparison and rows from Cloud
    When I reload the relative-date database
    Then the relative-date grid shows exactly "Yesterday task"
    And the saved date comparison is "Before" "Today"
    When I filter Due Date with "Before" "Tomorrow"
    Then the relative-date grid shows exactly "Yesterday task, Today task"
    When I filter Due Date with "After" "Yesterday"
    Then the relative-date grid shows exactly "Today task, Tomorrow task"
    When I filter Due Date with "On or before" "Today"
    Then the relative-date grid shows exactly "Yesterday task, Today task"
    When I filter Due Date with "On or after" "Today"
    Then the relative-date grid shows exactly "Today task, Tomorrow task"
    When I filter Due Date with "Is" "Today"
    Then the relative-date grid shows exactly "Today task"
    When I filter Due Date with "Before" "Today"
    And I switch the date comparison to advanced filters
    And I choose "Tomorrow" in the advanced date comparison
    Then the relative-date grid shows exactly "Yesterday task, Today task"
    And the saved date comparison is "Before" "Tomorrow"
    When I choose "Today" in the advanced date comparison
    Then the relative-date grid shows exactly "Yesterday task"
    And a fresh browser reads the same date comparison and rows from Cloud
    When I return to the database on the next day
    Then the relative-date grid shows exactly "Yesterday task, Today task"
    And the saved date comparison is "Before" "Today"
