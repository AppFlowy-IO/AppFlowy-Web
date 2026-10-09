@dashboard @dashboard-usecase @dashboard-template-3 @cloud
Feature: Field research dashboard at the twelve-widget limit
  Based on a French mycology researcher's biodiversity dashboard: three rows
  of four widgets (observation, collection and sequencing counts, trophic
  mode and station donuts, observations over time, conservation status,
  taxonomy bars), built right up to the twelve-widget limit, which its author
  complained about. The researcher reads it after every field trip and
  records a new find from the log. A full dashboard disables Duplicate and
  every add button with the "Dashboard is full" tooltip until a widget is
  deleted. For a poster she hides the widget titles and makes the first row
  compact with the keyboard.

  # Observation dates are today, today - 400 and today - 800: more than a
  # year apart, so each falls in its own calendar year on any run date. A
  # "per year" table names a bucket by one of its days: "today - 400" is the
  # year of that day ("2025" on 2026-10-06).

  Background:
    Given a workspace for the "Field research" use case
    And an "Observations" database with these properties:
      | property     | type     | options                         |
      | Station      | Select   | LT01, LT02, LT03                |
      | Trophic mode | Select   | Symbiotic, Saprotroph, Parasite |
      | Status       | Select   | Known, Rare, New species        |
      | Sequenced    | Checkbox |                                 |
      | Observed     | Date     |                                 |
      | Count        | Number   |                                 |
    And "Observations" has these rows:
      | Name                 | Station | Trophic mode | Status      | Sequenced | Observed    | Count |
      | Amanita muscaria     | LT01    | Symbiotic    | Known       | yes       | today - 800 | 3     |
      | Boletus edulis       | LT01    | Symbiotic    | Known       | yes       | today - 400 | 5     |
      | Trametes versicolor  | LT02    | Saprotroph   | Known       | no        | today - 400 | 12    |
      | Armillaria ostoyae   | LT02    | Parasite     | Rare        | yes       | today - 400 | 2     |
      | Cortinarius sp. nov. | LT03    | Symbiotic    | New species | yes       | today       | 1     |
      | Mycena haematopus    | LT03    | Saprotroph   | Known       | no        | today       | 7     |
      | Hericium coralloides | LT01    | Saprotroph   | Rare        | yes       | today       | 1     |
      | Laccaria amethystina | LT02    | Symbiotic    | Known       | no        | today - 800 | 4     |
      | Ophiocordyceps sp.   | LT03    | Parasite     | New species | no        | today       | 1     |
    And "Observations" has these views with their chart settings:
      | view                      | layout               | settings                                         |
      | Observations              | Number chart         | count                                            |
      | Specimens counted         | Number chart         | sum of Count                                     |
      | Sequenced                 | Number chart         | count where Sequenced is checked                 |
      | Sequencing rate           | Number chart         | percent checked of Sequenced                     |
      | Trophic mode              | Donut chart          | count by Trophic mode                            |
      | By station                | Donut chart          | count by Station                                 |
      | Observations per year     | Bar chart            | count by Observed per year                       |
      | Conservation status       | Horizontal bar chart | count by Status                                  |
      | Specimens per year        | Line chart           | sum of Count by Observed per year                |
      | Rare finds                | List                 | where Status is Rare, New species                |
      | Sequenced by trophic mode | Bar chart            | count by Trophic mode where Sequenced is checked |
      | Field log                 | Grid                 | sorted by Observed descending                    |
    And the "Field station" dashboard on "Observations" shows:
      | row | widgets                                                              |
      | 1   | Observations, Specimens counted, Sequenced, Sequencing rate          |
      | 2   | Trophic mode, By station, Observations per year, Conservation status |
      | 3   | Specimens per year, Rare finds, Sequenced by trophic mode, Field log |

  Scenario: The researcher reads the full field dashboard
    When I open the "Field station" dashboard
    Then the dashboard shows 12 widgets
    And the widths of dashboard row 1 are "3, 3, 3, 3"
    And the "Observations" widget shows the number "9"
    And the "Specimens counted" widget shows the number "36"
    And the "Sequenced" widget shows the number "5"
    # Percent checked prints one decimal unless it rounds to a whole number.
    And the "Sequencing rate" widget shows the number "55.6%"
    And the "Trophic mode" chart total is "9"
    And the "By station" chart total is "9"
    And the "Observations per year" chart shows these values per year:
      | year        | value |
      | today - 800 | 2     |
      | today - 400 | 3     |
      | today       | 4     |
    And the "Conservation status" chart shows these values:
      | label       | value |
      | Known       | 5     |
      | New species | 2     |
      | Rare        | 2     |
    And the "Specimens per year" chart shows these values per year:
      | year        | value |
      | today - 800 | 7     |
      | today - 400 | 19    |
      | today       | 10    |
    And the "Rare finds" widget lists "Armillaria ostoyae, Cortinarius sp. nov., Hericium coralloides, Ophiocordyceps sp."
    And the "Sequenced by trophic mode" chart shows these values:
      | label      | value |
      | Parasite   | 1     |
      | Saprotroph | 1     |
      | Symbiotic  | 3     |

  Scenario: Recording a new find from the field log
    When I open the "Field station" dashboard
    And I add a row named "Ganoderma applanatum" in the "Field log" widget
    And I open the "Ganoderma applanatum" row from the "Field log" widget
    And I set "Status" to "Rare" on the open page
    And I set "Count" to "2" on the open page
    And I close the row page
    Then the "Observations" widget shows the number "10"
    And the "Specimens counted" widget shows the number "38"
    And the "Sequencing rate" widget shows the number "50%"
    And the "Rare finds" widget lists "Armillaria ostoyae, Cortinarius sp. nov., Hericium coralloides, Ophiocordyceps sp., Ganoderma applanatum"
    # The new find has no observation date yet: it gets a bucket of its own.
    And the "Observations per year" chart shows these values per year:
      | year        | value |
      | today - 800 | 2     |
      | today - 400 | 3     |
      | today       | 4     |
      | No Observed | 1     |
    And the "Conservation status" chart shows these values:
      | label       | value |
      | Known       | 5     |
      | New species | 2     |
      | Rare        | 3     |

  Scenario: A full dashboard disables Duplicate and the add buttons until a widget is deleted
    When I open the "Field station" dashboard
    And I switch the dashboard to Edit mode
    Then the add to new row button is disabled
    When I click the "Field log" widget title
    Then the widget menu is open
    And "duplicate" is disabled in the widget menu
    When I hover "duplicate" in the widget menu
    Then the dashboard full tooltip is shown
    When I close the widget menu
    And I choose "delete" in the "Sequenced" widget menu
    Then the dashboard shows 11 widgets
    # The row that lost a widget splits equally again.
    And the widths of dashboard row 1 are "4, 4, 4"
    And dashboard row 1 offers an add widget button
    # Row 3 is full, so the copy starts row 4.
    When I choose "duplicate" in the "Field log" widget menu
    Then the dashboard shows 12 widgets
    And the dashboard has 4 rows
    And dashboard row 4 holds "Observations Field log (1)"
    # Row 4 holds one widget and row 1 three: only the twelve-widget limit
    # disables their add buttons.
    And dashboard row 4 offers a disabled add widget button
    And dashboard row 1 offers a disabled add widget button
    And the add to new row button is disabled

  Scenario: A poster version without widget titles and with a compact first row
    When I open the "Field station" dashboard
    And I switch the dashboard to Edit mode
    # The default row is 360 px; each ArrowUp takes 20 px off, down to the 240 px minimum.
    And I press "ArrowUp" 7 times on the height handle of dashboard row 1
    Then dashboard row 1 is about 240 px tall
    When I turn off the dashboard setting "Show widget titles"
    And I finish editing the dashboard
    Then no widget shows its title
    When I reload the dashboard
    Then dashboard row 1 is about 240 px tall
    And no widget shows its title
    # Without titles, the floating "Widget options" button still opens the menu.
    When I hover the "Field log" widget
    And I click the "Widget options" button of the "Field log" widget
    Then the widget menu is open
