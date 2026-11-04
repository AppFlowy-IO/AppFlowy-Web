Feature: PDF embeds on the production web server
  PDF.js runs its worker as a module script, and browsers refuse a module whose
  Content-Type is not JavaScript. The production server sent the worker as
  application/octet-stream, so every inline PDF stopped on its spinner and then
  only offered "Try again" (AppFlowy-IO/AppFlowy#9116). The Vite dev server
  always serves it correctly, so this must run against a production build.

  Scenario: An uploaded PDF renders inline
    Given I am signed in on a new document page
    When I upload "sample.pdf" in a new PDF embed block
    Then the PDF embed renders the pages of "sample.pdf"
    And the PDF worker script is served as JavaScript
