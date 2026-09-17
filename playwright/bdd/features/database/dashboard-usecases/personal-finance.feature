@dashboard @dashboard-usecase @cloud
Feature: Personal finance overview
  Based on Notion's official "Personal Finance Tracker" dashboard (spending
  totals and an expense breakdown donut). Its owner logs expenses from the
  dashboard and reviews recent spending.

  Background:
    Given a workspace for the "Personal finance" use case
    And an "Expenses" database with these properties:
      | property | type   | options                        |
      | Category | Select | Rent, Groceries, Utilities, Fun |
      | Amount   | Number |                                |
      | Spent on | Date   |                                |
    And "Expenses" has these rows:
      | Name           | Category  | Amount | Spent on   |
      | Rent           | Rent      | 1800   | today - 10 |
      | Supermarket    | Groceries | 240    | today - 3  |
      | Electricity    | Utilities | 95     | today - 6  |
      | Concert        | Fun       | 120    | today - 1  |
      | Farmers market | Groceries | 60     | today - 40 |
    And "Expenses" has these views:
      | view              | layout       | settings                 |
      | Total spent       | Number chart | sum of Amount            |
      | Expense breakdown | Donut chart  | sum of Amount by Category |
      | Expenses          | Grid         |                          |
    And the "Money" dashboard on "Expenses" shows:
      | row | widgets                        |
      | 1   | Total spent, Expense breakdown |
      | 2   | Expenses                       |

  Scenario: Logging an expense from the dashboard
    When I open the "Money" dashboard
    Then the "Total spent" widget shows the number "2,315"
    When I add a row named "Weekly shop" in the "Expenses" widget
    And I change the "Category" of "Weekly shop" to "Groceries" in the "Expenses" widget
    And I change the "Amount" of "Weekly shop" to "500" in the "Expenses" widget
    Then the "Total spent" widget shows the number "2,815"
    And the "Expense breakdown" chart total is "2,815"
    When I click the "Groceries" segment of the "Expense breakdown" chart
    Then the drill-down lists "Supermarket, Farmers market, Weekly shop"

  Scenario: Reviewing the last 30 days
    When I open the "Money" dashboard
    And I add a global filter where "Spent on" is on or after "today - 30"
    Then the "Total spent" widget shows the number "2,255"
    And the "Expenses" widget lists "Rent, Supermarket, Electricity, Concert"
