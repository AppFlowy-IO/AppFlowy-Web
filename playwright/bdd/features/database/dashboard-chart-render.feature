@dashboard @cloud
Feature: Dashboard chart rendering
  # Same text as desktop integration_test/desktop/bdd/database/dashboard/
  # dashboard_chart_render_cloud.feature (WP10 §6.3); only this comment and the
  # tags differ. The fixture is dashboard-parity/bdd/chart-fixtures.json.

  Background:
    Given a Pro workspace for chart rendering is ready
    And the chart fixture {'deals'} is seeded

  Scenario: Chart widgets fill their cards at every row height
    Given the dashboard {'Revenue'} on {'Deals'} has the rows {'Amount by owner, Deals by stage'}
    When the user opens the dashboard {'Revenue'} on {'Deals'}
    Then the chart of the dashboard widget {'Amount by owner'} fills its card
    And the chart of the dashboard widget {'Deals by stage'} fills its card
    When the dashboard row {1} is resized to {240} pixels
    Then the chart of the dashboard widget {'Amount by owner'} fills its card
    And the chart of the dashboard widget {'Deals by stage'} fills its card
    When the dashboard row {1} is resized to {600} pixels
    Then the chart of the dashboard widget {'Amount by owner'} fills its card
    And the chart of the dashboard widget {'Deals by stage'} fills its card

  Scenario: Values keep their currency symbol and use compact numbers
    Given the dashboard {'Revenue'} on {'Deals'} has the rows {'Amount by owner'}
    When the user opens the dashboard {'Revenue'} on {'Deals'}
    Then the dashboard widget {'Amount by owner'} shows the value axis ticks {'$0, $500K, $1M, $1.5M'}
    And the dashboard widget {'Amount by owner'} shows no value axis line
    And the dashboard widget {'Amount by owner'} shows the data labels {'Alice: $48.5K, Bob: $1.3M, Carol: $690K'}
    When the user hovers the category {'Bob'} of the dashboard widget {'Amount by owner'}
    Then the chart tooltip shows {'Bob'} with the value {'$1,300,000'}
    And the chart tooltip offers {'Click to view data'}
    And the dashboard widget {'Amount by owner'} highlights the category {'Bob'}

  Scenario: Negative values are drawn below the zero line
    Given the dashboard {'Margins'} on {'Deals'} has the rows {'Margin by stage, Margin bars'}
    When the user opens the dashboard {'Margins'} on {'Deals'}
    Then the dashboard widget {'Margin by stage'} shows the value axis ticks {'-2K, -1K, 0, 1K, 2K'}
    And the dashboard widget {'Margin by stage'} shows the data labels {'Lead: 800, Lost: -1.5K, Proposal: 1.2K, Won: 6.5'}
    And the bar {'Lost'} of the dashboard widget {'Margin by stage'} extends below the zero line
    And the bar {'Won'} of the dashboard widget {'Margin by stage'} extends above the zero line
    And the bar {'Lost'} of the dashboard widget {'Margin bars'} extends left of the zero line

  Scenario: Decimal places fix the precision of the labels and are saved for everyone
    When the user opens the chart view {'Margin by stage'} of the database {'Deals'}
    And the user sets the chart decimal places to {'2'}
    Then the chart shows the data labels {'Lead: 800.00, Lost: -1.5K, Proposal: 1.2K, Won: 6.50'}
    And the chart view {'Margin by stage'} stores {'decimal_places'} as {'2'}
    When the user sets the chart decimal places to {'Auto'}
    Then the chart shows the data labels {'Lead: 800, Lost: -1.5K, Proposal: 1.2K, Won: 6.5'}
    And the chart view {'Margin by stage'} stores {'decimal_places'} as {'null'}

  Scenario: A donut shows a rounded total, shares and option colors
    Given the dashboard {'Pipeline'} on {'Deals'} has the rows {'Deals by stage | Amount share'}
    When the user opens the dashboard {'Pipeline'} on {'Deals'}
    Then the dashboard widget {'Deals by stage'} shows the donut total {'12'} over {'Total'}
    And the dashboard widget {'Deals by stage'} colors the categories {'Lead: #5E9FE8, Lost: #DF84A8, Proposal: #EAC26B, Won: #72BC8F'}
    When the user hovers the category {'Won'} of the dashboard widget {'Deals by stage'}
    Then the chart tooltip shows {'Won'} with the value {'4 (33.3%)'}
    And the dashboard widget {'Amount share'} shows the donut total {'$2M'} over {'Total'}
    And the dashboard widget {'Amount share'} shows the outside label {'Bob $1.3M (63.8%)'}
    And the dashboard widget {'Amount share'} shows no outside label for {'Alice'}

  Scenario: Color themes recolor a chart in display order
    When the user opens the chart view {'Deals by stage'} of the database {'Deals'}
    And the user sets the chart color to {'Colorful'}
    Then the chart colors its categories in display order with {'#5E9FE8, #EAC26B, #72BC8F, #BF8EDA'}
    When the user sets the chart color to {'Blue'}
    Then the chart colors its categories in display order with {'#5E9FE8, #8EBCEF, #AFCFF4, #C7DDF7'}
    And the chart view {'Deals by stage'} stores {'color_theme'} as {'blue'}

  Scenario: Rows without a value are charted in gray
    Given the dashboard {'Regions'} on {'Deals'} has the rows {'Deals by region'}
    When the user opens the dashboard {'Regions'} on {'Deals'}
    Then the dashboard widget {'Deals by region'} colors the category {'No Region'} with {'#F1F1EF'}

  Scenario: Crowded category labels rotate and truncate, roomy ones stay flat
    Given the dashboard {'Regions'} on {'Deals'} has the rows {'Deals by region, Amount by owner, Deals by stage, Margin by stage'}
    When the user opens the dashboard {'Regions'} on {'Deals'}
    Then the category labels of the dashboard widget {'Deals by region'} are rotated
    And the first category label of the dashboard widget {'Deals by region'} ends with an ellipsis
    And the category labels of the dashboard widget {'Amount by owner'} are horizontal
    When the user hovers the first category of the dashboard widget {'Deals by region'}
    Then the chart tooltip shows the full name of that category

  Scenario: A line chart draws a smooth labelled line with a legend
    Given the dashboard {'Trend'} on {'Deals'} has the rows {'Monthly deals'}
    When the user opens the dashboard {'Trend'} on {'Deals'}
    Then the dashboard widget {'Monthly deals'} draws a smooth line
    And the dashboard widget {'Monthly deals'} shows the data labels {'Jan 2026: 2, Feb 2026: 5, Mar 2026: 3, Apr 2026: 2'}
    And the dashboard widget {'Monthly deals'} shows the legend {'Count all'}
    And the dashboard widget {'Monthly deals'} shows no data points
    When the user hovers the category {'Feb 2026'} of the dashboard widget {'Monthly deals'}
    Then the dashboard widget {'Monthly deals'} shows a data point at {'Feb 2026'}
    And the chart tooltip shows {'Feb 2026'} with the value {'5'}

  Scenario: A narrow donut pages through its legend
    Given the dashboard {'Regions'} on {'Deals'} has the rows {'Region share, Amount by owner, Deals by stage, Margin by stage'}
    When the user opens the dashboard {'Regions'} on {'Deals'}
    Then the legend of the dashboard widget {'Region share'} is paginated
    When the user shows the next legend page of the dashboard widget {'Region share'}
    Then the legend of the dashboard widget {'Region share'} shows page {2}

  Scenario: Empty charts say No data
    Given the dashboard {'Archive'} on {'Archive'} has the rows {'Archived by stage, Archived amounts'}
    When the user opens the dashboard {'Archive'} on {'Archive'}
    Then the dashboard widget {'Archived by stage'} shows an empty donut ring with {'No data'}
    And the dashboard widget {'Archived amounts'} shows {'No data'}

  Scenario: The tooltip never outlives the pointer or the data
    Given the dashboard {'Revenue'} on {'Deals'} has the rows {'Amount by owner'}
    When the user opens the dashboard {'Revenue'} on {'Deals'}
    And the user hovers the category {'Bob'} of the dashboard widget {'Amount by owner'}
    Then the chart tooltip shows {'Bob'} with the value {'$1,300,000'}
    When the pointer leaves the dashboard widget {'Amount by owner'}
    Then no chart tooltip is shown
    When the user hovers the category {'Bob'} of the dashboard widget {'Amount by owner'}
    And the {'Amount'} of {'Beacon'} in {'Deals'} changes to {'2000000'} in the background
    Then no chart tooltip is shown
    And the dashboard widget {'Amount by owner'} shows the data labels {'Alice: $48.5K, Bob: $2.3M, Carol: $690K'}

  Scenario: Style settings hide the data labels and the legend
    When the user opens the chart view {'Monthly deals'} of the database {'Deals'}
    And the user turns off the chart data labels
    Then the chart shows no data labels
    And the chart view {'Monthly deals'} stores {'show_data_labels'} as {'false'}
    When the user sets the chart legend to {'Off'}
    Then the chart shows no legend
    And the chart view {'Monthly deals'} stores {'legend_position'} as {'off'}
