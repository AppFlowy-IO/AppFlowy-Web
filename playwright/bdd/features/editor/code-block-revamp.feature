Feature: Revamped code blocks, Mermaid diagrams and callout page conversion
  Code block settings, Mermaid display modes and Turn into Page conversions are
  saved to the real document, so they survive a reload and create real pages.

  Background:
    Given a blank document page is open

  Scenario: Language, pinned language, wrapping and caption persist after reload
    When I choose slash command "code"
    And I type the following text in the editor:
      """
      const answer: number = 42;
      """
    And I choose code language "TypeScript" by searching "ts"
    And I toggle "Pin language" in the code block options menu
    And I toggle "Wrap code" in the code block options menu
    And I add the code block caption "The answer constant"
    And I reload the code block document
    Then code block 0 shows language "TypeScript"
    And code block 0 has its language pinned
    And code block 0 wraps long lines
    And code block 0 has caption "The answer constant"
    And code block 0 contains exactly:
      """
      const answer: number = 42;
      """

  Scenario: Format code loads the formatter on demand and can be undone
    When I choose slash command "code"
    And I type the following text in the editor:
      """
      const value={a:1,b:[1,2]}
      """
    And I choose code language "JavaScript" by searching "javascript"
    And I choose "Format code" from the code block options menu
    Then code block 0 contains exactly:
      """
      const value = { a: 1, b: [1, 2] };
      """
    When I undo the editor change
    Then code block 0 contains exactly:
      """
      const value={a:1,b:[1,2]}
      """

  Scenario: Code stays literal while normal paragraphs keep Markdown shortcuts
    When I choose slash command "code"
    And I type "**bold** _italic_ `inline` /path" in code block 0
    And I press "Enter"
    And I press "Tab"
    And I type "indented()" in code block 0
    Then code block 0 contains exactly:
      """
      **bold** _italic_ `inline` /path
        indented()
      """
    And code block 0 has no rich text formatting
    And the slash menu is hidden

  Scenario: Mermaid insertion renders the example diagram and keeps its display mode after reload
    When I choose slash command "mermaid"
    Then code block 0 contains exactly:
      """
      graph TD
        Mermaid --> Diagram
      """
    And code block 0 renders a Mermaid diagram
    When I set the Mermaid display mode to "Preview"
    Then code block 0 shows only the Mermaid preview
    When I reload the code block document
    Then code block 0 shows only the Mermaid preview
    And code block 0 renders a Mermaid diagram

  Scenario: Turning a code block into a page moves the code and language into a new child page
    When I choose slash command "code"
    And I type the following text in the editor:
      """
      print("hello from a page")
      """
    And I choose code language "Python" by searching "py"
    And I turn code block 0 into a page from its six-dot menu
    Then the new page opens with a "Python" code block containing:
      """
      print("hello from a page")
      """
    When I close the opened page
    Then editor block 0 has type "sub_page"
    And the document has 0 "code" block

  Scenario: Turning a callout into a page keeps its title and nested body, and undo restores it
    When I choose slash command "callout"
    And I type "Release checklist" in the editor
    And I press "Enter"
    And I type "Ship the web build" in the editor
    And I turn the callout "Release checklist" into a page from its six-dot menu
    Then the new page opens titled "Release checklist" with a callout containing "Ship the web build"
    When I close the opened page
    Then editor block 0 has type "sub_page"
    And the editor does not visibly contain "Ship the web build"
    When I return to the document editor
    And I undo the editor change
    Then a "callout" block contains "Release checklist"
    And a "callout" block contains "Ship the web build"
