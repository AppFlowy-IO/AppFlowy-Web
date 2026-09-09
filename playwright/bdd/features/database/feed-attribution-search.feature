@feed-attribution-search
Feature: Feed search finds attribution display names

  Background:
    Given the Feed interaction fixture is ready

  Scenario Outline: Attribution search follows row metadata while the query stays active
    Given a Feed whose visible "<property>" names the current user on one card
    When the user searches the Feed for that attribution display name
    Then only the initially attributed Feed card appears
    When the visible attribution moves to another Feed card
    Then the same search shows only the newly attributed Feed card
    When the visible attribution is removed from that Feed card
    Then no Feed cards match until the attribution search is cleared

    Examples:
      | property       |
      | Created by     |
      | Last edited by |
