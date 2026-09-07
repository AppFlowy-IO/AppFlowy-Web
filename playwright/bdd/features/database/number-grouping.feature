Feature: Number grouping matches Desktop
  Numbers can be grouped by their exact numeric value or by configured ranges.
  A range includes its lower bound, and only the final range includes its upper bound.

  Scenario: Default ranges separate zero, boundaries, outliers, and missing values
    Given a Grid contains the following numbers for number grouping
      | value   |
      | -1      |
      | 0       |
      | 10      |
      | 90      |
      | 100     |
      | 101     |
      | <empty> |
    When I group the Grid by its number field
    Then number grouping uses Range with Start "0", End "100", and Interval "10"
    And the number groups contain these row counts
      | bucket    | rows |
      | empty     | 1    |
      | < 0       | 1    |
      | [0, 10)   | 1    |
      | [10, 20)  | 1    |
      | [90, 100] | 2    |
      | > 100     | 1    |
    When I show empty number groups
    Then the number groups contain these row counts
      | bucket   | rows |
      | [20, 30) | 0    |
      | [30, 40) | 0    |
      | [40, 50) | 0    |
      | [50, 60) | 0    |
      | [60, 70) | 0    |
      | [70, 80) | 0    |
      | [80, 90) | 0    |
    When I reload the number-grouped Grid
    Then number grouping uses Range with Start "0", End "100", and Interval "10"
    And the number groups contain these row counts
      | bucket    | rows |
      | [20, 30)  | 0    |
      | [90, 100] | 2    |
      | > 100     | 1    |
    When I hide empty number groups
    Then the number group "[20, 30)" is not displayed
    And the number groups contain these row counts
      | bucket  | rows |
      | empty   | 1    |
      | [0, 10) | 1    |

  Scenario: Exact values merge decimal spellings and sort numerically after reopening
    Given a Grid contains the following numbers for number grouping
      | value   |
      | 1       |
      | 1.0     |
      | 1.00    |
      | 2       |
      | 10      |
      | -2      |
      | 0       |
      | <empty> |
    When I group the Grid by its number field
    And I select Exact value number grouping
    Then the number groups contain these row counts
      | bucket | rows |
      | empty  | 1    |
      | = -2   | 1    |
      | = 0    | 1    |
      | = 1    | 3    |
      | = 2    | 1    |
      | = 10   | 1    |
    And the displayed number groups are ordered as follows
      | bucket |
      | empty  |
      | = -2   |
      | = 0    |
      | = 1    |
      | = 2    |
      | = 10   |
    When I sort number groups descending
    And I reload the number-grouped Grid
    Then Exact value number grouping is selected
    And the displayed number groups are ordered as follows
      | bucket |
      | empty  |
      | = 10   |
      | = 2    |
      | = 1    |
      | = 0    |
      | = -2   |
    When I sort number groups ascending
    Then the displayed number groups are ordered as follows
      | bucket |
      | empty  |
      | = -2   |
      | = 0    |
      | = 1    |
      | = 2    |
      | = 10   |

  Scenario: Signed decimal ranges use exact boundaries and a shortened final bucket
    Given a Grid contains the following numbers for number grouping
      | value   |
      | -0.6    |
      | -0.5    |
      | -0.3    |
      | 0       |
      | 0.5     |
      | 0.6     |
      | 0.7     |
      | <empty> |
    When I group the Grid by its number field
    And I apply number ranges with Start "-0.5", End "0.6", and Interval "0.2"
    And I show empty number groups
    Then the number groups contain these row counts
      | bucket       | rows |
      | empty        | 1    |
      | < -0.5       | 1    |
      | [-0.5, -0.3) | 1    |
      | [-0.3, -0.1) | 1    |
      | [-0.1, 0.1)  | 1    |
      | [0.1, 0.3)   | 0    |
      | [0.3, 0.5)   | 0    |
      | [0.5, 0.6]   | 2    |
      | > 0.6        | 1    |
    When I reload the number-grouped Grid
    Then number grouping uses Range with Start "-0.5", End "0.6", and Interval "0.2"
    And the number groups contain these row counts
      | bucket       | rows |
      | [-0.3, -0.1) | 1    |
      | [0.5, 0.6]   | 2    |
      | > 0.6        | 1    |

  Scenario: Invalid range drafts cannot replace the saved configuration
    Given a Grid contains the following numbers for number grouping
      | value |
      | -1    |
      | 1     |
      | 11    |
    When I group the Grid by its number field
    Then these invalid range drafts cannot be applied or saved
      | start | end  | interval |
      | 0     | 100  | 0        |
      | 0     | 100  | -1       |
      | 0     | 0    | 10       |
      | 100   | 0    | 10       |
      | nope  | 100  | 10       |
      | 0     | 1001 | 1        |
    When I reload the number-grouped Grid
    Then number grouping uses Range with Start "0", End "100", and Interval "10"
    And the number groups contain these row counts
      | bucket   | rows |
      | < 0      | 1    |
      | [0, 10)  | 1    |
      | [10, 20) | 1    |

  Scenario: Adding a row inside a range prefills that range's lower bound
    Given a Grid contains the following numbers for number grouping
      | value   |
      | 1       |
      | 11      |
      | <empty> |
    When I group the Grid by its number field
    And I add a row to number group "[10, 20)"
    Then the number groups contain these row counts
      | bucket   | rows |
      | [10, 20) | 2    |
    When I select Exact value number grouping
    Then the number groups contain these row counts
      | bucket | rows |
      | empty  | 1    |
      | = 1    | 1    |
      | = 10   | 1    |
      | = 11   | 1    |
