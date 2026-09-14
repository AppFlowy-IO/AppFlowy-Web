@formula @formula-conditions
Feature: Filtering, sorting and calculating formula results
  A formula filters with the conditions of its result type, sorts in the
  order of its result type and feeds the footer calculations, and all of it
  follows the inputs as they change.

  Background:
    Given a Grid for formula testing with these properties
      | property | type     | row 1   | row 2   | row 3      | row 4   |
      | Name     | Text     | Apple   | Banana  | Cherry     | Date    |
      | Price    | Number   | 5       | 20      | 50         | <empty> |
      | Done     | Checkbox | yes     | no      | yes        | no      |
      | Due      | Date     | today-1 | today   | today+1    | <empty> |

  # ---------------------------------------------------------------------------
  # Filters
  # ---------------------------------------------------------------------------

  Scenario: Number results use number conditions
    Given a formula property "Double" with the expression "if(empty(prop("Price")), empty(), prop("Price") * 2)"
    Then filtering "Double" by these number conditions shows these rows
      | condition                | value | rows                  |
      | equal                    | 40    | Banana                |
      | not equal                | 40    | Apple, Cherry         |
      | greater than             | 10    | Banana, Cherry        |
      | less than                | 40    | Apple                 |
      | greater than or equal to | 40    | Banana, Cherry        |
      | less than or equal to    | 40    | Apple, Banana         |
      | is empty                 |       | Date                  |
      | is not empty             |       | Apple, Banana, Cherry |

  Scenario: Text results use text conditions
    Given a formula property "Label" with the expression "lower(prop("Name"))"
    Then filtering "Label" by these text conditions shows these rows
      | condition        | value  | rows                        |
      | is               | banana | Banana                      |
      | is not           | banana | Apple, Cherry, Date         |
      | contains         | an     | Banana                      |
      | does not contain | an     | Apple, Cherry, Date         |
      | starts with      | ch     | Cherry                      |
      | ends with        | e      | Apple, Date                 |
      | is empty         |        |                             |
      | is not empty     |        | Apple, Banana, Cherry, Date |

  Scenario: Checkbox results use checkbox conditions
    Given a formula property "Open" with the expression "not prop("Done")"
    Then filtering "Open" by these checkbox conditions shows these rows
      | condition | rows          |
      | checked   | Banana, Date  |
      | unchecked | Apple, Cherry |

  Scenario: Date results use date conditions
    Given a formula property "Next" with the expression "dateAdd(prop("Due"), 1, "days")"
    Then filtering "Next" by these date conditions shows these rows
      | condition    | rows                  |
      | is today     | Apple                 |
      | is tomorrow  | Banana                |
      | is yesterday |                       |
      | is on today  | Apple                 |
      | is empty     | Date                  |
      | is not empty | Apple, Banana, Cherry |

  Scenario: The filter chip, the header menu and a reload keep the formula filter
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I add a filter on "Double" from its header menu
    And I set the open number filter to "greater than" "30"
    Then the filter chip reads "Double: > 30"
    And the grid shows these rows
      | Banana |
      | Cherry |
    When I reload the grid
    Then the filter chip reads "Double: > 30"
    And the grid shows these rows
      | Banana |
      | Cherry |

  Scenario: Filtered rows follow input and formula changes
    Given a formula property "Double" with the expression "prop("Price") * 2"
    When I filter "Double" with the number condition "greater than" and value "30"
    Then the grid shows these rows
      | Banana |
      | Cherry |
    # Row 1 of the filtered grid is Banana.
    When I type "10" into row 1 of "Price"
    Then the grid shows these rows
      | Cherry |
    When I open the formula editor of "Double" from the property menu
    And I type the formula "prop("Price") * 10"
    And I close the formula editor with "the Done button"
    Then the grid shows these rows
      | Apple  |
      | Banana |
      | Cherry |

  Scenario: The advanced filter uses the conditions of the result type
    Given a formula property "Double" with the expression "prop("Price") * 2"
    And a formula property "Label" with the expression "lower(prop("Name"))"
    When I filter "Double" with the number condition "greater than" and value "30"
    And I switch the filters to advanced mode
    Then the advanced filter row for "Double" offers these conditions
      | =            |
      | ≠            |
      | >            |
      | <            |
      | ≥            |
      | ≤            |
      | Is empty     |
      | Is not empty |
    When I add an advanced filter rule on "Label"
    Then the advanced filter row for "Label" offers these conditions
      | Contains         |
      | Does not contain |
      | Starts with      |
      | Ends with        |
      | Is               |
      | Is not           |
      | Is empty         |
      | Is not empty     |
    And the grid shows these rows
      | Banana |
      | Cherry |

  # ---------------------------------------------------------------------------
  # Sorts
  # ---------------------------------------------------------------------------

  Scenario: Results sort in the order of their type
    Given a formula property "Double" with the expression "prop("Price") * 2"
    And a formula property "Label" with the expression "lower(prop("Name"))"
    And a formula property "Next" with the expression "dateAdd(prop("Due"), 1, "days")"
    When I sort "Double" descending
    Then the grid shows these rows
      | Cherry |
      | Banana |
      | Apple  |
      | Date   |
    When I remove all sorts
    And I sort "Label" descending
    Then the grid shows these rows
      | Date   |
      | Cherry |
      | Banana |
      | Apple  |
    When I remove all sorts
    And I sort "Next" ascending
    Then the grid shows these rows
      | Apple  |
      | Banana |
      | Cherry |
      | Date   |

  Scenario: The sort order follows input changes and keeps empty results last
    Given a formula property "Double" with the expression "if(empty(prop("Price")), empty(), prop("Price") * 2)"
    When I sort "Double" ascending
    Then the grid shows these rows
      | Apple  |
      | Banana |
      | Cherry |
      | Date   |
    When I type "30" into row 1 of "Price"
    Then the grid shows these rows
      | Banana |
      | Apple  |
      | Cherry |
      | Date   |
    When I remove all sorts
    And I sort "Double" descending
    Then the grid shows these rows
      | Cherry |
      | Apple  |
      | Banana |
      | Date   |

  # ---------------------------------------------------------------------------
  # Calculations
  # ---------------------------------------------------------------------------

  Scenario: Number results offer every calculation and respect the number format
    Given a formula property "Double" with the expression "if(empty(prop("Price")), empty(), prop("Price") * 2)"
    Then the calculation options for "Double" are
      | Count all       |
      | Count empty     |
      | Count not empty |
      | Sum             |
      | Average         |
      | Min             |
      | Max             |
      | Median          |
    And the calculations of "Double" show
      | calculation     | value |
      | Sum             | 150   |
      | Average         | 50    |
      | Median          | 40    |
      | Min             | 10    |
      | Max             | 100   |
      | Count all       | 4     |
      | Count empty     | 1     |
      | Count not empty | 3     |
    When I set the calculation of "Double" to "Sum"
    And I set the number format of "Double" to "US dollar"
    Then the calculation of "Double" shows "$150"
    When I type "35" into row 1 of "Price"
    Then the calculation of "Double" shows "$210"

  Scenario: Text results offer count calculations
    Given a formula property "Label" with the expression "if(prop("Done"), lower(prop("Name")), "")"
    Then the calculation options for "Label" are
      | Count all       |
      | Count empty     |
      | Count not empty |
    And the calculations of "Label" show
      | calculation     | value |
      | Count all       | 4     |
      | Count empty     | 2     |
      | Count not empty | 2     |

  Scenario: Date results offer count calculations
    Given a formula property "Next" with the expression "dateAdd(prop("Due"), 1, "days")"
    Then the calculation options for "Next" are
      | Count all       |
      | Count empty     |
      | Count not empty |
    And the calculations of "Next" show
      | calculation     | value |
      | Count all       | 4     |
      | Count empty     | 1     |
      | Count not empty | 3     |

  Scenario: Checkbox results count checked and unchecked rows
    Given a formula property "Open" with the expression "not prop("Done")"
    Then the calculation options for "Open" are
      | Count all       |
      | Count unchecked |
      | Count checked   |
    And the calculations of "Open" show
      | calculation     | value |
      | Count all       | 4     |
      | Count unchecked | 2     |
      | Count checked   | 2     |
