@text-cell-rich-text
Feature: Rich text editing in database Text cells
  A Text property cell holds inline rich text, like Notion's Text property:
  bold, italic, underline, strikethrough, inline code, highlight, links,
  mentions and inline equations, with Shift+Enter line breaks. Block content
  (lists, headings, slash commands) is not available inside a cell.
  The cell's plain text stays in `data` so Desktop, search, sort and filters
  keep working; the formatting is stored beside it.

  Background:
    Given a grid with a rich text property is open

  Scenario Outline: Keyboard shortcuts format the selected text
    When I start editing the rich text cell in row 1
    And I type "Hello world" in the rich text cell
    And I select "world" in the rich text cell
    And I press "<shortcut>" in the rich text cell
    And I press Enter in the rich text cell
    Then the rich text cell in row 1 is not being edited
    And the stored rich text cell in row 1 has plain text "Hello world"
    And the stored rich text cell in row 1 marks "world" as <mark>
    And the stored rich text cell in row 1 does not mark "Hello " as <mark>
    And the rich text cell in row 1 displays "world" as <mark>

    Examples:
      | shortcut             | mark          |
      | ControlOrMeta+b      | bold          |
      | ControlOrMeta+i      | italic        |
      | ControlOrMeta+u      | underline     |
      | ControlOrMeta+Shift+s | strikethrough |
      | ControlOrMeta+e      | code          |
      | ControlOrMeta+Shift+h | highlight     |
      | ControlOrMeta+Shift+e | equation      |

  Scenario Outline: Markdown shortcuts format text while typing
    When I start editing the rich text cell in row 1
    And I type "Say <source>" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Say <plain>"
    And the stored rich text cell in row 1 marks "<marked>" as <mark>
    And the rich text cell in row 1 displays "<marked>" as <mark>

    Examples:
      | source         | plain    | marked | mark          |
      | **bold**       | bold     | bold   | bold          |
      | *italic*       | italic   | italic | italic        |
      | ~~gone~~       | gone     | gone   | strikethrough |
      | `code`         | code     | code   | code          |
      | $$E=mc^2$$     | E=mc^2   | E=mc^2 | equation      |

  Scenario: The selection toolbar formats text and hides block actions
    When I start editing the rich text cell in row 1
    And I type "Toolbar text" in the rich text cell
    And I select "Toolbar" in the rich text cell
    Then the rich text toolbar is visible
    And the rich text toolbar does not offer block formatting
    When I click the rich text toolbar "bold" button
    And I click the rich text toolbar "italic" button
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "Toolbar" as bold
    And the stored rich text cell in row 1 marks "Toolbar" as italic
    And the stored rich text cell in row 1 does not mark " text" as bold

  Scenario: Shift+Enter adds a line break and Enter saves the cell
    When I start editing the rich text cell in row 1
    And I type "First line" in the rich text cell
    And I press "Shift+Enter" in the rich text cell
    And I type "Second line" in the rich text cell
    Then the rich text cell in row 1 is being edited
    When I press Enter in the rich text cell
    Then the rich text cell in row 1 is not being edited
    And the stored rich text cell in row 1 has plain text "First line\nSecond line"

  Scenario: Escape and clicking outside also save the edit
    When I start editing the rich text cell in row 1
    And I type "Saved by escape" in the rich text cell
    And I press "Escape" in the rich text cell
    Then the rich text cell in row 1 is not being edited
    And the stored rich text cell in row 1 has plain text "Saved by escape"
    When I start editing the rich text cell in row 2
    And I type "Saved by click" in the rich text cell
    And I click outside the rich text cell
    Then the rich text cell in row 2 is not being edited
    And the stored rich text cell in row 2 has plain text "Saved by click"

  Scenario: Formatting survives a reload
    When I start editing the rich text cell in row 1
    And I type "Keep me bold" in the rich text cell
    And I select "bold" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "bold" as bold
    When I reload the rich text grid
    Then the rich text cell in row 1 displays "bold" as bold
    When I start editing the rich text cell in row 1
    Then the rich text editor shows "bold" as bold

  Scenario: Removing every mark from saved text clears its formatting
    When I start editing the rich text cell in row 1
    And I type "Plain again" in the rich text cell
    And I select "again" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "again" as bold
    When I start editing the rich text cell in row 1
    And I select "again" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Plain again"
    And the stored rich text cell in row 1 has no formatting
    When I reload the rich text grid
    Then the stored rich text cell in row 1 has plain text "Plain again"
    And the stored rich text cell in row 1 has no formatting
    And the rich text cell in row 1 shows plain text "Plain again"
    And the rich text cell in row 1 displays no formatting
    When I start editing the rich text cell in row 1
    Then the rich text editor does not show "again" as bold

  Scenario: Undo inside the cell reverts formatting before it is saved
    When I start editing the rich text cell in row 1
    And I type "Undo me" in the rich text cell
    And I select "me" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    Then the rich text editor shows "me" as bold
    When I press "ControlOrMeta+z" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Undo me"
    And the stored rich text cell in row 1 has no formatting

  Scenario: Command+K links the selected text
    When I start editing the rich text cell in row 1
    And I type "Read the docs" in the rich text cell
    And I select "docs" in the rich text cell
    And I press "ControlOrMeta+k" in the rich text cell
    And I enter the link "https://docs.appflowy.io" in the link popover
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Read the docs"
    And the stored rich text cell in row 1 links "docs" to "https://docs.appflowy.io"
    And the rich text cell in row 1 displays "docs" as link

  Scenario: Pasting a URL onto selected text links it
    When I start editing the rich text cell in row 1
    And I type "AppFlowy site" in the rich text cell
    And I select "AppFlowy" in the rich text cell
    And I paste "https://appflowy.io" into the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "AppFlowy site"
    And the stored rich text cell in row 1 links "AppFlowy" to "https://appflowy.io"

  Scenario: Pasting a bare URL inserts a link
    When I start editing the rich text cell in row 1
    And I type "See " in the rich text cell
    And I paste "https://appflowy.io" into the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "See https://appflowy.io"
    And the stored rich text cell in row 1 links "https://appflowy.io" to "https://appflowy.io"

  Scenario: Clicking a link in a saved cell opens it without editing the cell
    When I start editing the rich text cell in row 1
    And I type "Example site" in the rich text cell
    And I select "Example" in the rich text cell
    And I paste "https://example.com" into the rich text cell
    And I press Enter in the rich text cell
    Then clicking "Example" in the rich text cell in row 1 opens "https://example.com"
    And the rich text cell in row 1 is not being edited

  Scenario: Pasting multi-line plain text keeps the lines in one cell
    When I start editing the rich text cell in row 1
    And I paste "alpha\nbeta\ngamma" into the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "alpha\nbeta\ngamma"

  Scenario: Pasting formatted document content keeps inline formatting as lines
    When I start editing the rich text cell in row 1
    And I paste a document fragment with a bold heading "Plan" and a paragraph "ship it" into the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Plan\nship it"
    And the stored rich text cell in row 1 marks "Plan" as bold

  Scenario: Typing @ mentions today's date
    When I start editing the rich text cell in row 1
    And I type "Due " in the rich text cell
    And I type "@" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the "Today" date in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a date mention for today
    And the stored rich text cell in row 1 has plain text "Due @" followed by today's date
    And the rich text cell in row 1 displays a date mention

  Scenario: Typing @ mentions a page
    When I start editing the rich text cell in row 1
    And I type "See @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the page "Getting started" in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a page mention
    And the stored rich text cell in row 1 has plain text "See Getting started"
    And the rich text cell in row 1 displays a page mention "Getting started"
    When I click the page mention "Getting started" in the rich text cell in row 1
    Then the page "Getting started" is open

  Scenario: Slash and block markdown stay literal text
    When I start editing the rich text cell in row 1
    And I type "/todo" in the rich text cell
    Then the slash menu is not shown
    # With a menu open, Escape would only close the menu.
    When I press "Escape" in the rich text cell
    Then the rich text cell in row 1 is not being edited
    And the stored rich text cell in row 1 has plain text "/todo"
    When I start editing the rich text cell in row 1
    And I press "Shift+Enter" in the rich text cell
    And I type "# not a heading" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "/todo\n# not a heading"
    And the stored rich text cell in row 1 has no formatting

  Scenario: Filters match the plain text of formatted cells
    When I start editing the rich text cell in row 1
    And I type "Launch **plan**" in the rich text cell
    And I press Enter in the rich text cell
    And I add a rich text property filter that contains "Launch plan"
    Then the grid shows 1 row

  Scenario: Text changed by another client drops stale formatting
    When I start editing the rich text cell in row 1
    And I type "Formatted" in the rich text cell
    And I select "Formatted" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "Formatted" as bold
    When another client sets the rich text cell in row 1 to plain text "Edited on desktop"
    Then the rich text cell in row 1 shows plain text "Edited on desktop"
    And the rich text cell in row 1 displays no formatting
    And the stored rich text cell in row 1 still holds the formatting saved for "Formatted"

  Scenario: The row detail page edits the same rich text
    When I start editing the rich text cell in row 1
    And I type "Detail **view**" in the rich text cell
    And I press Enter in the rich text cell
    And I open the row detail for row 1
    Then the row detail rich text property displays "view" as bold
    When I edit the row detail rich text property and append " more"
    Then the stored rich text cell in row 1 has plain text "Detail view more"
    And the stored rich text cell in row 1 marks "view" as bold

  Scenario: The Name (title) cell supports rich text in the grid
    Given I edit the Name property
    When I start editing the rich text cell in row 1
    And I type "Launch **plan**" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Launch plan"
    And the stored rich text cell in row 1 marks "plan" as bold
    And the rich text cell in row 1 displays "plan" as bold

  Scenario: The row page title shows and edits the title's formatting
    Given I edit the Name property
    When I start editing the rich text cell in row 1
    And I type "Big **idea**" in the rich text cell
    And I press Enter in the rich text cell
    And I open the row detail for row 1
    Then the row title shows "idea" as bold
    When I type " today" at the end of the row title
    And I select "today" in the row title
    And I press "ControlOrMeta+i" in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Big idea today"
    And the stored rich text cell in row 1 marks "idea" as bold
    And the stored rich text cell in row 1 marks "today" as italic

  Scenario: The row page title is a single line saved as it is typed
    Given I edit the Name property
    When I open the row detail for row 1
    And I type "One" at the end of the row title
    And I press "Shift+Enter" in the rich text cell
    And I press "Enter" in the rich text cell
    Then the row title is not focused
    And the row title reads "One"
    And the stored rich text cell in row 1 has plain text "One"

  Scenario: The row page title can mention a page
    Given I edit the Name property
    When I open the row detail for row 1
    And I type "Notes for @" at the end of the row title
    Then the mention panel is shown for the rich text cell
    When I choose the page "Getting started" in the mention panel
    Then the stored rich text cell in row 1 has a page mention
    And the stored rich text cell in row 1 has plain text "Notes for Getting started"

  Scenario: Typing [[ links a page
    When I start editing the rich text cell in row 1
    And I type "See [[" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the page "Getting started" in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a page mention
    And the stored rich text cell in row 1 has plain text "See Getting started"
    And the rich text cell in row 1 displays a page mention "Getting started"

  Scenario: Typing + at the start of a word links a page
    When I start editing the rich text cell in row 1
    And I type "Read +" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the page "Getting started" in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a page mention
    And the stored rich text cell in row 1 has plain text "Read Getting started"

  Scenario: Typing [[ then Escape keeps the brackets as text
    When I start editing the rich text cell in row 1
    And I type "a [[" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I press "Escape" in the rich text cell
    Then the mention panel is hidden
    When I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "a [["

  Scenario: + and @ inside a word stay text
    When I start editing the rich text cell in row 1
    And I type "C++ is 1+1 at me@appflowy.io" in the rich text cell
    Then the mention panel is not shown
    When I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "C++ is 1+1 at me@appflowy.io"
    And the stored rich text cell in row 1 has no formatting

  Scenario: The toolbar colors text and its background
    When I start editing the rich text cell in row 1
    And I type "Red alert" in the rich text cell
    And I select "Red" in the rich text cell
    And I pick color number 3 from the rich text toolbar "text color" menu
    And I select "alert" in the rich text cell
    And I pick color number 3 from the rich text toolbar "background color" menu
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "Red" as text-color
    And the stored rich text cell in row 1 marks "alert" as background-color
    And the rich text cell in row 1 displays "Red" as text-color
    And the rich text cell in row 1 displays "alert" as background-color

  Scenario: The toolbar turns the selection into an inline equation
    When I start editing the rich text cell in row 1
    And I type "Area a^2" in the rich text cell
    And I select "a^2" in the rich text cell
    And I click the rich text toolbar "equation" button
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "a^2" as equation
    And the stored rich text cell in row 1 has plain text "Area a^2"
    And the rich text cell in row 1 displays "a^2" as equation

  Scenario: Pressing a format shortcut again removes the format
    When I start editing the rich text cell in row 1
    And I type "Toggle" in the rich text cell
    And I select "Toggle" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    Then the rich text editor shows "Toggle" as bold
    When I press "ControlOrMeta+b" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Toggle"
    And the stored rich text cell in row 1 has no formatting

  Scenario: Database undo and redo restore a saved formatted edit
    When I start editing the rich text cell in row 1
    And I type "Undo **saved**" in the rich text cell
    And I press Enter in the rich text cell
    And I press the database undo shortcut outside the cell
    Then the stored rich text cell in row 1 has plain text ""
    When I press the database redo shortcut outside the cell
    Then the stored rich text cell in row 1 has plain text "Undo saved"
    And the stored rich text cell in row 1 marks "saved" as bold
    And the rich text cell in row 1 displays "saved" as bold

  Scenario: Copying formatted text from one cell and pasting it into another keeps the format
    When I start editing the rich text cell in row 1
    And I type "Copy **me** please" in the rich text cell
    And I select "Copy me" in the rich text cell
    And I press "ControlOrMeta+c" in the rich text cell
    And I press Enter in the rich text cell
    And I start editing the rich text cell in row 2
    And I press "ControlOrMeta+v" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 2 has plain text "Copy me"
    And the stored rich text cell in row 2 marks "me" as bold
    And the stored rich text cell in row 2 does not mark "Copy " as bold

  Scenario: Escape closes the mention panel without leaving the cell
    When I start editing the rich text cell in row 1
    And I type "Hi @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I press "Escape" in the rich text cell
    Then the mention panel is hidden
    And the rich text cell in row 1 is being edited
    When I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Hi @"
    And the stored rich text cell in row 1 has no formatting

  Scenario: Enter picks the highlighted mention instead of saving the cell
    When I start editing the rich text cell in row 1
    And I type "Due @tomorrow" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I press "ArrowDown" in the rich text cell
    And I press "Enter" in the rich text cell
    Then the mention panel is hidden
    And the rich text cell in row 1 is being edited
    When I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a date mention for tomorrow

  Scenario: Wrap shows every line of a formatted cell
    When I start editing the rich text cell in row 1
    And I type "**Line one**" in the rich text cell
    And I press "Shift+Enter" in the rich text cell
    And I type "Line two" in the rich text cell
    And I press Enter in the rich text cell
    And I turn wrapping on for the rich text property
    Then the rich text cell in row 1 shows its lines wrapped
    When I turn wrapping off for the rich text property
    Then the rich text cell in row 1 shows its lines on one line

  Scenario: Switching the property type and back keeps the text and its format
    When I start editing the rich text cell in row 1
    And I type "Keep **format**" in the rich text cell
    And I press Enter in the rich text cell
    And I change the rich text property to a "Number" property
    Then the rich text property is a "Number" property
    When I change the rich text property to a "RichText" property
    Then the rich text property is a "RichText" property
    And the rich text cell in row 1 displays "format" as bold
    And the stored rich text cell in row 1 has plain text "Keep format"

  Scenario: Other layouts show the formatted text read-only
    When I start editing the rich text cell in row 1
    And I type "List **item**" in the rich text cell
    And I press Enter in the rich text cell
    And I switch the rich text database to the "List" layout
    Then the list row 1 displays "item" as bold

  Scenario: Duplicating a row copies the formatted text
    When I start editing the rich text cell in row 1
    And I type "Dup **me**" in the rich text cell
    And I press Enter in the rich text cell
    And I duplicate row 1 from its row detail
    Then the duplicated row has plain text "Dup me" marking "me" as bold

  Scenario: Clearing a formatted cell removes its formatting
    When I start editing the rich text cell in row 1
    And I type "**Gone soon**" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "Gone soon" as bold
    When I start editing the rich text cell in row 1
    And I press "ControlOrMeta+a" in the rich text cell
    And I press "Backspace" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text ""
    And the stored rich text cell in row 1 has no formatting

  Scenario: Mention chips keep their layout when no document has been opened
    When I start editing the rich text cell in row 1
    And I type "See @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the page "Getting started" in the mention panel
    And I type " on @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the "Today" date in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a page mention
    And the stored rich text cell in row 1 has a date mention for today
    # Opens the grid on its own: no document editor loads its stylesheet.
    When I reload the rich text grid
    Then the rich text cell in row 1 shows its page mention "Getting started" on one line
    And the rich text cell in row 1 shows its date mention on one line
    And row 1 of the rich text grid keeps its default height

  Scenario: Typing @ mentions a person
    When I start editing the rich text cell in row 1
    And I type "Owner @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the first person in the mention panel
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a person mention
    And the stored rich text cell in row 1 has plain text "Owner @" followed by the chosen person's name
    And the rich text cell in row 1 displays a person mention

  Scenario: Text typed after a mention stays plain text in the cell
    When I start editing the rich text cell in row 1
    And I type "Owner @" in the rich text cell
    Then the mention panel is shown for the rich text cell
    When I choose the first person in the mention panel
    And I type " reviews it" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has a person mention
    And the stored rich text cell in row 1 has plain text ending with " reviews it"

  Scenario: Prices and ranges are not turned into equations or strikethrough
    When I start editing the rich text cell in row 1
    And I type "Costs $5 and $6, ~5 to ~10 days" in the rich text cell
    And I press Enter in the rich text cell
    Then the stored rich text cell in row 1 has plain text "Costs $5 and $6, ~5 to ~10 days"
    And the stored rich text cell in row 1 has no formatting

  Scenario: Enter saves when the page-link panel has nothing highlighted
    When I start editing the rich text cell in row 1
    And I type "Call +1 555 0100" in the rich text cell
    And I press "Enter" in the rich text cell
    Then the rich text cell in row 1 is not being edited
    And the stored rich text cell in row 1 has plain text "Call +1 555 0100"


  Scenario: Board cards show the title's formatting
    Given I edit the Name property
    When I start editing the rich text cell in row 1
    And I type "Board **card**" in the rich text cell
    And I press Enter in the rich text cell
    And I switch the rich text database to the "Board" layout
    Then a board card displays "card" as bold

  Scenario: Gallery cards show the title's formatting
    Given I edit the Name property
    When I start editing the rich text cell in row 1
    And I type "Gallery *card*" in the rich text cell
    And I press Enter in the rich text cell
    And I switch the rich text database to the "Gallery" layout
    Then a gallery card displays "card" as italic

  Scenario: Redo inside the cell reapplies undone formatting
    When I start editing the rich text cell in row 1
    And I type "Redo me" in the rich text cell
    And I select "me" in the rich text cell
    And I press "ControlOrMeta+b" in the rich text cell
    And I press "ControlOrMeta+z" in the rich text cell
    Then the rich text editor does not show "me" as bold
    When I press "ControlOrMeta+Shift+z" in the rich text cell
    Then the rich text editor shows "me" as bold
    When I press Enter in the rich text cell
    Then the stored rich text cell in row 1 marks "me" as bold
