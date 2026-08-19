Feature: Paste at cursor position
  Reproduces the bug where pasted text lands on the next line instead of the
  caret position. A single inline snippet — whether copied from another app
  (text/html clipboard flavor) or from AppFlowy itself
  (application/x-appflowy-fragment) — must be inserted into the current block
  at the caret, not appended as a sibling paragraph below.

  Background:
    Given a blank document page is open

  Scenario: Text copied from a web page pastes at the caret, not on the next line
    When I type "The quick brown fox" in the editor
    And I select text from offset 10 to offset 10 in editor block 0
    And I paste html content at the current caret:
      """
      <meta charset="utf-8"><span style="color: rgb(55, 53, 47);">PASTED</span>
      """
    Then the editor has exactly 1 top-level block
    And editor block 0 contains "The quick PASTEDbrown fox"

  Scenario: A word copied inside AppFlowy pastes at the caret, not on the next line
    When I type "The quick brown fox" in the editor
    And I select text from offset 4 to offset 9 in editor block 0
    And I copy the current editor selection
    And I select text from offset 10 to offset 10 in editor block 0
    And I paste the copied content at the current caret
    Then the editor has exactly 1 top-level block
    And editor block 0 contains "The quick quickbrown fox"

  Scenario: Multi-line paste merges its first line at the caret
    When I type "The quick brown fox" in the editor
    And I select text from offset 10 to offset 10 in editor block 0
    And I paste html content at the current caret:
      """
      <p>ALPHA</p><p>BETA</p>
      """
    Then editor block 0 contains "The quick ALPHA"
    And the editor contains "BETA"
