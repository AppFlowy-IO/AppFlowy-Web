Feature: Editor editing
  Migrated from appflowy-editor edit, command, IME, shortcut, paste, and undo tests.

  Background:
    Given a blank document page is open

  Scenario: Basic text input, replacement, and deletion
    When I type "Hello AppFlowy" in the editor
    Then the editor contains "Hello AppFlowy"
    When I start a new editor paragraph
    And I type "Hello World" in the editor
    And I select the last word
    And I type "AppFlowy" in the editor
    Then the editor contains "Hello AppFlowy"
    And the editor does not contain "Hello World"
    When I type " Test" in the editor
    And I delete the previous word
    Then the editor does not contain "Hello AppFlowy Test"

  Scenario: Split a paragraph with Enter
    When I type "SplitHere" in the editor
    And I move the caret left 4 characters
    And I press "Enter"
    Then the editor contains "Split"
    And the editor contains "Here"

  Scenario: Insert a soft break with Shift Enter
    When I type "Line 1" in the editor
    And I press "Shift+Enter"
    And I type "Line 2" in the editor
    Then the document has 1 "paragraph" block
    And the editor contains "Line 1"
    And the editor contains "Line 2"

  Scenario: Undo and redo typed content
    When I type "Redo Me" in the editor
    Then the editor contains "Redo Me"
    When I undo the editor change
    Then the editor does not contain "Redo Me"
    When I redo the editor change
    Then the editor contains "Redo Me"

  Scenario: Multi-step undo and redo restores document state
    When I type "1. " in the editor
    Then editor block 0 has type "numbered_list"
    When I undo the editor change
    Then editor block 0 has type "paragraph"
    When I redo the editor change
    Then editor block 0 has type "numbered_list"
    When I type "Apple" in the editor
    And I press "Enter"
    And I type "Banana" in the editor
    And I press "Enter"
    And I type "Cherry" in the editor
    Then the editor has at least 3 top-level blocks
    When I undo the editor change 30 times
    Then the editor has exactly 1 top-level block
    And editor block 0 contains ""
    When I redo the editor change 30 times
    Then the editor has at least 3 top-level blocks
    And editor block 0 has type "numbered_list"
    And editor block 0 contains "Apple"
    And editor block 1 contains "Banana"
    And editor block 2 contains "Cherry"
    When I undo the editor change 30 times
    And I type "Fresh start" in the editor
    And I redo the editor change 10 times
    Then the editor has exactly 1 top-level block
    And editor block 0 contains "Fresh start"

  Scenario Outline: Markdown prefixes convert text blocks
    When I type "<input>" in the editor
    Then a "<block_type>" block contains "<content>"
    And the editor does not contain "<input>"

    Examples:
      | input            | block_type    | content       |
      | # Heading 1      | heading       | Heading 1     |
      | ## Heading 2     | heading       | Heading 2     |
      | - Bullet Item    | bulleted_list | Bullet Item   |
      | 1. Numbered Item | numbered_list | Numbered Item |
      | [] Todo Item     | todo_list     | Todo Item     |
      | > Toggle Item    | toggle_list   | Toggle Item   |
      | ### Heading 3    | heading       | Heading 3     |
      | * Star Bullet    | bulleted_list | Star Bullet   |
      | + Plus Bullet    | bulleted_list | Plus Bullet   |

  Scenario: Markdown divider prefix creates a divider block
    When I type "---" in the editor
    Then the document has 1 "divider" block

  Scenario: Quote markdown prefix converts to a quote block
    When I type quote markdown text "Quote Text" in the editor
    Then a "quote" block contains "Quote Text"

  Scenario: Inline markdown converts text marks
    When I type "Normal **Bold Text** Normal" in the editor
    Then "bold" formatting contains "Bold Text"
    And the editor does not contain "Normal **Bold Text** Normal"
    When I start a new editor paragraph
    And I type "Normal *Italic Text* Normal" in the editor
    Then "italic" formatting contains "Italic Text"
    And the editor does not contain "Normal *Italic Text* Normal"
    When I start a new editor paragraph
    And I type "Normal ~~Strike Text~~ Normal" in the editor
    Then "strikethrough" formatting contains "Strike Text"
    And the editor does not contain "Normal ~~Strike Text~~ Normal"
    When I start a new editor paragraph
    And I type "Normal `Inline Code` Normal" in the editor
    Then inline code contains "Inline Code"
    And the editor does not contain "`Inline Code`"

  Scenario Outline: Selected text formatting shortcuts apply marks
    When I type "<content>" in the editor
    And I select all editor content
    And I apply the "<format>" formatting shortcut
    Then "<format>" formatting contains "<content>"

    Examples:
      | format        | content         |
      | bold          | Bold Shortcut   |
      | italic        | Italic Shortcut |
      | underline     | Underline Text  |
      | strikethrough | Strike Shortcut |
      | code          | Code Shortcut   |

  Scenario: Slash menu opens and dismisses
    When I open the slash menu
    Then the slash menu is visible
    And the slash menu command "heading1" is visible
    And the slash menu command "todoList" is visible
    When I press "Escape"
    Then the slash menu is hidden

  Scenario: Keyboard Enter selects a filtered slash command
    When I open the slash menu
    And I search the slash menu for "quote"
    Then the slash menu has 1 visible command
    And I press "Enter"
    Then editor block 0 has type "quote"

  Scenario Outline: Slash commands create text blocks
    When I choose slash command "<command>"
    And I type "<content>" in the editor
    Then a "<block_type>" block contains "<content>"

    Examples:
      | command      | block_type    | content        |
      | heading1     | heading       | Slash Heading  |
      | bulletedList | bulleted_list | Slash Bullet   |
      | numberedList | numbered_list | Slash Number   |
      | todoList     | todo_list     | Slash Todo     |
      | quote        | quote         | Slash Quote    |
      | code         | code          | const value = 1 |

  Scenario Outline: Slash trigger on non-empty line inserts a new block below
    When I type "Hello world" in the editor
    And I type slash in the editor
    And I search the slash menu for "<search>"
    And I select slash command "<command>"
    Then editor block 0 has type "paragraph"
    And editor block 0 contains "Hello world"
    And editor block 1 has type "<block_type>"
    And the editor has exactly 2 top-level blocks

    Examples:
      | search  | command  | block_type |
      | heading | heading1 | heading    |
      | quote   | quote    | quote      |

  Scenario: Slash divider command creates a divider block
    When I choose slash command "divider"
    Then the document has 1 "divider" block

  Scenario: Slash table command creates a simple table block
    When I choose slash command "simpleTable"
    Then the document has 1 "simple_table" block

  Scenario: Indent and outdent a bulleted list item
    When I type "- Parent Item" in the editor
    And I press "Enter"
    And I type "Child Item" in the editor
    Then a "bulleted_list" block contains "Child Item"
    When I press "Tab"
    Then "Child Item" is nested under "Parent Item" in "bulleted_list"
    When I press "Shift+Tab"
    Then "Child Item" is not nested under "Parent Item" in "bulleted_list"

  Scenario: Toggle a todo item with the checkbox
    When I type "[] Checkbox Todo" in the editor
    Then a "todo_list" block contains "Checkbox Todo"
    When I toggle the todo item checkbox
    Then the todo item "Checkbox Todo" is checked
    When I toggle the todo item checkbox
    Then the todo item "Checkbox Todo" is not checked

  Scenario: Toggle list interactions collapse and expand content
    When I type "> Parent Toggle" in the editor
    And I press "Enter"
    And I type "Hidden Child" in the editor
    Then the editor visibly contains "Hidden Child"
    When I toggle the toggle list icon
    Then the editor does not visibly contain "Hidden Child"
    And the first toggle list is collapsed
    When I press the toggle block shortcut
    Then the first toggle list is expanded
    And the editor visibly contains "Hidden Child"
    When I press the toggle block shortcut
    Then the first toggle list is collapsed
    And the editor does not visibly contain "Hidden Child"
    When I toggle the toggle list icon
    Then the first toggle list is expanded
    And the editor visibly contains "Hidden Child"

  Scenario: Empty toggle list clears back to paragraph
    When I type "> " in the editor
    And I press "Enter"
    Then editor block 0 has type "paragraph"

  Scenario: Toolbar and alignment actions update the selected block
    When I type "Toolbar Block" in the editor
    And I apply the "left" alignment shortcut
    Then editor block 0 has alignment "left"
    When I apply the "center" alignment shortcut
    Then editor block 0 has alignment "center"
    When I apply the "right" alignment shortcut
    Then editor block 0 has alignment "right"
    When I select all editor content
    And I apply the "heading1" block toolbar action
    Then editor block 0 has type "heading"
    When I select all editor content
    And I apply the "bulletedList" block toolbar action
    Then editor block 0 has type "bulleted_list"
    When I select all editor content
    And I apply the "numberedList" block toolbar action
    Then editor block 0 has type "numbered_list"
    When I select all editor content
    And I apply the "quote" block toolbar action
    Then editor block 0 has type "quote"

  Scenario: Toolbar applies a link to selected text
    When I type "appflowy" in the editor
    And I select all editor content
    And I apply link "https://appflowy.io" from the toolbar
    Then link mark "appflowy" has href "https://appflowy.io"

  Scenario: Paste rich HTML, markdown headings, and plain text
    When I paste html content:
      """
      <meta charset="utf-8"><h2><strong>User Installation</strong></h2><ul><li><a href="https://appflowy.io/download">Windows/Mac/Linux</a></li><li><a href="https://appflowy.io/docs">Docs</a></li></ul>
      """
    Then a "heading" block contains "User Installation"
    And "bold" formatting contains "User Installation"
    And link mark "Windows/Mac/Linux" has href "https://appflowy.io/download"
    And link mark "Docs" has href "https://appflowy.io/docs"
    When I paste markdown text:
      """
      # I'm h1
      ## I'm h2
      ### I'm h3
      """
    Then a "heading" block contains "I'm h1"
    And a "heading" block contains "I'm h2"
    And a "heading" block contains "I'm h3"
    When I paste plain text:
      """
      First pasted line
      Second pasted line
      """
    Then the editor contains "First pasted line"
    And the editor contains "Second pasted line"

  Scenario: Escape exits selection editing mode
    When I type "Exit editing mode" in the editor
    And I select all editor content
    Then the selection toolbar is visible
    When I press "Escape"
    Then the selection toolbar is hidden
