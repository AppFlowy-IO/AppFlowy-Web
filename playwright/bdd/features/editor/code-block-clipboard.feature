Feature: Code block copy and paste
  Pasting copied AppFlowy content into a code block inserts literal text at
  the selection, preserving indentation and line breaks without adding blocks.

  Background:
    Given a blank document page is open

  Scenario: Native keyboard copy and paste preserves multiline code and supports undo and redo
    When I choose slash command "code"
    And I type the following text in the editor:
      """
      const message = "hello";
        console.log(message);
      """
    And I press "ControlOrMeta+a"
    And I press "ControlOrMeta+c"
    And I press "ArrowRight"
    And I press "ControlOrMeta+v"
    Then the editor has exactly 1 top-level block
    And code block 0 contains exactly:
      """
      const message = "hello";
        console.log(message);const message = "hello";
        console.log(message);
      """
    When I undo the editor change
    Then code block 0 contains exactly:
      """
      const message = "hello";
        console.log(message);
      """
    When I redo the editor change
    Then the editor has exactly 1 top-level block
    And code block 0 contains exactly:
      """
      const message = "hello";
        console.log(message);const message = "hello";
        console.log(message);
      """

  Scenario Outline: Copied code respects the destination selection
    When I choose slash command "code"
    And I type "const source = target;" in the editor
    And I select text from offset 6 to offset 12 in editor block 0
    And I copy the current editor selection
    And I select text from offset 15 to offset <end> in editor block 0
    And I paste the copied content at the current caret
    Then the editor has exactly 1 top-level block
    And code block 0 contains exactly:
      """
      <expected>
      """

    Examples:
      | end | expected                    |
      | 15  | const source = sourcetarget; |
      | 21  | const source = source;       |

  Scenario: Copied paragraph text fills an empty code block without changing its type
    When I type "paragraph source" in the editor
    And I select text from offset 0 to offset 16 in editor block 0
    And I copy the current editor selection
    And I type "" in the editor
    And I choose slash command "code"
    And I select text from offset 0 to offset 0 in editor block 0
    And I paste the copied content at the current caret
    Then the editor has exactly 1 top-level block
    And code block 0 contains exactly:
      """
      paragraph source
      """
