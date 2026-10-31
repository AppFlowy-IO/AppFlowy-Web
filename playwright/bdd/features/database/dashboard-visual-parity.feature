@dashboard-visual-parity @cloud
Feature: Dashboard visual parity with the desktop app
  The web and desktop dashboards share one UI: icon glyphs and sizes,
  typography, colours, spacing, paddings, radii and control heights. Both
  clients measure their rendered dashboard against the same contract
  (dashboard-parity/visual-metrics.json, tokens.json and icons.json) and write
  a report per state; the reports are compared row by row. Pending entries are
  measured and reported, enforced entries must match.

  Background:
    Given the canonical dashboard visual parity fixture is open

  Scenario Outline: The dashboard matches the shared visual contract in <mode> mode with the <theme> theme
    When I measure every dashboard parity scene in <mode> mode with the <theme> theme
    Then every enforced dashboard style metric matches the shared tokens in <mode> mode with the <theme> theme
    And every enforced dashboard element order matches the shared contract in <mode> mode with the <theme> theme
    And every enforced dashboard text matches the shared contract in <mode> mode with the <theme> theme
    And every enforced dashboard icon renders its canonical glyph in <mode> mode with the <theme> theme
    And the dashboard parity report for <mode> mode with the <theme> theme is written

    Examples:
      | mode | theme |
      | View | light |
      | View | dark  |
      | Edit | light |
      | Edit | dark  |
