@llm-regressions
Feature: Saved LLM demo presentations retain content and open their sources
  These scenarios reuse the existing LLM Iteration Lab snapshot in the confirmed local workspace.

  Background:
    Given the test user signs in through the UI to the confirmed paid presentation workspace
    And the existing LLM Iteration Lab fixture is open

  Scenario: An unchanged mind map opens its database evidence without generating again
    When the saved LLM mind map is opened twice
    Then its database citations show readable names and open the cited row
    And reopening the LLM result made no generation or preference writes

  Scenario: Saved slides open directly and changing slide count keeps the setup stable
    When the saved LLM presentation is opened
    Then the presentation has one dialog and no source-version footer
    And reopening the LLM result made no generation or preference writes
    When the slide count is changed and restored in regeneration settings
    Then the settings keep their size and do not repeat source analysis

  Scenario: Present document contains no empty slides and reuses its loaded database
    When the LLM document is presented from its loaded editor
    Then every document slide has content and the experiment database is visible

  Scenario: Exported LLM images match the preview proportions
    When the saved LLM presentation is opened
    And the LLM presentation is exported through the download dialog
    Then each exported image fits its preview slot without stretching
