@dashboard @dashboard-usecase @dashboard-template-2 @cloud @inventory-reorder
Feature: Shop inventory and reorder dashboard
  Based on the eBay seller dashboard (a KPI snapshot of number widgets on
  two dashboard tabs, "Current month" and "All time"), the "Stock &
  Inventory Management" templates in Notion's gallery, and the Money
  Tracker's lowest and highest value tiles. The shop owner checks low stock
  every morning, calls one supplier with the page narrowed to them, restocks
  in the products table and comes back, and keeps a second dashboard tab for
  the receiving desk with its own saved filter.

  # Both databases have a "Supplier site" URL property, so one filter maps
  # both. A duplicated tab is named "<name> (Copy)" and opens; it keeps
  # showing the same shared views. A duplicated widget goes next to its
  # source, or on a new row right below when that row is full.

  Background:
    Given a workspace for the "Inventory" use case
    And a "Products" database with these properties:
      | property      | type     | options                |
      | Category      | Select   | Mugs, Prints, Stickers |
      | Stock         | Number   |                        |
      | Unit cost     | Number   | US dollar              |
      | Supplier site | URL      |                        |
      | Active        | Checkbox |                        |
    And "Products" has these rows:
      | Name             | Category | Stock | Unit cost | Supplier site             | Active |
      | Mountain mug     | Mugs     | 4     | 6.5       | https://ceramico.example  | yes    |
      | Ocean mug        | Mugs     | 16    | 6.5       | https://ceramico.example  | yes    |
      | City print A3    | Prints   | 2     | 3.2       | https://printhaus.example | yes    |
      | Forest print A4  | Prints   | 25    | 2.4       | https://printhaus.example | yes    |
      | Cat sticker pack | Stickers | 120   | 0.4       | https://stickerly.example | yes    |
      | Dog sticker pack | Stickers | 7     | 0.4       | https://stickerly.example | yes    |
      | Retro mug        | Mugs     | 0     | 7         | https://ceramico.example  | no     |
      | Galaxy print A3  | Prints   | 9     | 3.2       | https://printhaus.example | yes    |
    And a "Purchase orders" database with these properties:
      | property      | type      | options |
      | Supplier site | URL       |         |
      | Units         | Number    |         |
      | Received      | Checklist |         |
      | Ordered       | Date      |         |
    And "Purchase orders" has these rows:
      | Name             | Supplier site             | Units | Received                                | Ordered    |
      | PO-311 Ceramico  | https://ceramico.example  | 48    | [x] Counted, [x] Inspected, [x] Shelved | today - 12 |
      | PO-312 Printhaus | https://printhaus.example | 60    | [x] Counted, [ ] Inspected, [ ] Shelved | today - 4  |
      | PO-313 Stickerly | https://stickerly.example | 500   | [ ] Counted, [ ] Inspected, [ ] Shelved | today - 1  |
      | PO-314 Ceramico  | https://ceramico.example  | 24    | [x] Counted, [x] Inspected, [ ] Shelved | today - 2  |
    And "Products" has these views:
      | view              | layout               | settings                                                                    |
      | Units in stock    | Number chart         | sum of Stock                                                                |
      | Lowest stock      | Number chart         | min of Stock where Active is checked                                        |
      | Highest unit cost | Number chart         | max of Unit cost                                                            |
      | Price points      | Number chart         | count unique values of Unit cost                                            |
      | Stock by category | Horizontal bar chart | sum of Stock by Category                                                    |
      | Low stock         | Grid                 | sorted by Stock ascending where Stock is less than 10 and Active is checked |
    And "Purchase orders" has these views:
      | view           | layout       | settings                     |
      | Units on order | Number chart | sum of Units                 |
      | Receiving      | List         | where Received is incomplete |
    And the "Stock" dashboard on "Products" shows:
      | row | widgets                                                       |
      | 1   | Units in stock, Lowest stock, Highest unit cost, Price points |
      | 2   | Stock by category, Low stock                                  |
      | 3   | Units on order, Receiving                                     |

  Scenario: The morning stock check
    When I open the "Stock" dashboard
    Then the "Units in stock" widget shows the number "183"
    And the "Lowest stock" widget shows the number "2"
    And the "Highest unit cost" widget shows the number "$7.00"
    And the "Price points" widget shows the number "5"
    And the "Stock by category" chart shows these values:
      | label    | value |
      | Mugs     | 20    |
      | Prints   | 36    |
      | Stickers | 127   |
    And the "Low stock" widget lists in order "City print A3, Mountain mug, Dog sticker pack, Galaxy print A3"
    And the "Units on order" widget shows the number "632"
    And the "Receiving" widget lists "PO-312 Printhaus, PO-313 Stickerly, PO-314 Ceramico"

  Scenario: Calling one supplier, then scanning low stock and open deliveries
    When I open the "Stock" dashboard
    And I add a global filter on "Supplier site" with the condition "Contains" and the value "ceramico"
    Then the "Supplier site" global filter chip shows 2 sources
    And the "Units in stock" widget shows the number "20"
    And the "Lowest stock" widget shows the number "4"
    And the "Highest unit cost" widget shows the number "$7.00"
    And the "Price points" widget shows the number "2"
    And the "Low stock" widget lists in order "Mountain mug"
    And the "Units on order" widget shows the number "72"
    And the "Receiving" widget lists "PO-314 Ceramico"
    When I remove the global filter "Supplier site"
    And I add a global filter on "Stock" with the condition "Is less than" and the value "10"
    Then the "Units in stock" widget shows the number "22"
    And the "Price points" widget shows the number "4"
    And the "Stock by category" chart shows these values:
      | label    | value |
      | Mugs     | 4     |
      | Prints   | 11    |
      | Stickers | 7     |
    And the "Units on order" widget shows the number "632"
    When I remove the global filter "Stock"
    And I add a global filter on "Received" with the condition "Is incomplete" and the value ""
    Then the "Units on order" widget shows the number "584"
    And the "Receiving" widget lists "PO-312 Printhaus, PO-313 Stickerly, PO-314 Ceramico"
    And the "Units in stock" widget shows the number "183"

  Scenario: Restocking in the products table outside the dashboard, then coming back
    When I open the "Stock" dashboard
    And I choose "view-data-source" in the "Low stock" widget menu
    Then the "Low stock" view is open outside the dashboard
    When I change the "Stock" of "City print A3" to "40" in the open grid
    Then the "Stock" of "City print A3" in "Products" is "40"
    When I open the "Stock" dashboard
    Then the "Low stock" widget lists in order "Mountain mug, Dog sticker pack, Galaxy print A3"
    And the "Units in stock" widget shows the number "221"
    And the "Lowest stock" widget shows the number "4"
    And the "Stock by category" chart shows these values:
      | label    | value |
      | Mugs     | 20    |
      | Prints   | 74    |
      | Stickers | 127   |

  Scenario: A second dashboard tab for the receiving desk, with its own saved filter
    When I open the "Stock" dashboard
    And I switch the dashboard to Edit mode
    # Row 1 is full, so the copy starts a new row right below it.
    And I choose "duplicate" in the "Price points" widget menu
    Then the dashboard shows 9 widgets
    And the dashboard has 4 rows
    And dashboard row 2 has widths "12"
    When I press the dashboard undo shortcut
    Then the dashboard shows 8 widgets
    And the dashboard has 3 rows
    When I finish editing the dashboard
    And I duplicate the "Stock" dashboard tab
    Then the active dashboard tab is named "Stock (Copy)"
    When I rename the dashboard tab to "Receiving desk"
    Then the active dashboard tab is named "Receiving desk"
    And the dashboard shows 8 widgets
    When I switch the dashboard to Edit mode
    And I delete the "Stock by category" widget
    And I finish editing the dashboard
    # View mode: adding the filter is shared, its condition and value stay
    # on this device until they are saved for everyone.
    And I add a global filter on "Ordered" with the condition "Is on or after" and the value "today - 7"
    Then the "Ordered" global filter shows an unsaved dot
    And the "Units on order" widget shows the number "584"
    And the "Receiving" widget lists "PO-312 Printhaus, PO-313 Stickerly, PO-314 Ceramico"
    When I click "Save for everyone" in the filter bar
    Then no unsaved dot is shown on the dashboard
    And the dashboard shows 7 widgets
    And the "Units on order" widget shows the number "584"
    When I open the "Stock" dashboard
    Then the dashboard shows 8 widgets
    And the dashboard shows 0 global filter chips
    And the "Units on order" widget shows the number "632"
    When I open the "Receiving desk" dashboard
    Then the dashboard shows 1 global filter chip
    And the "Units on order" widget shows the number "584"
    When I reload the dashboard
    Then the active dashboard tab is named "Receiving desk"
    And the dashboard shows 1 global filter chip
    And no unsaved dot is shown on the dashboard
    And the "Units on order" widget shows the number "584"
    When I open the "Stock" dashboard
    Then the dashboard shows 0 global filter chips
    And the "Stock by category" chart shows these values:
      | label    | value |
      | Mugs     | 20    |
      | Prints   | 36    |
      | Stickers | 127   |
