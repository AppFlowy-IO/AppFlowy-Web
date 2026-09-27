import { formulaLiteralOpenerAt, formulaPasteContext, normalizePastedFormula } from '../formula-paste';

const NAMES = ['Impact', 'Confidence', 'Effort', 'Opportunity', 'Opportunity ID', 'Due date', '状态', 'length', 'if'];

function paste(text: string, names = NAMES) {
  return normalizePastedFormula(text, names);
}

describe('normalizePastedFormula', () => {
  it('leaves formulas that already use prop() unchanged', () => {
    expect(paste('prop("Impact") * prop("Confidence") / prop("Effort")')).toBe(
      'prop("Impact") * prop("Confidence") / prop("Effort")'
    );
  });

  describe('bare property names', () => {
    it('wraps bare names in prop()', () => {
      expect(paste('Impact * Confidence / Effort')).toBe('prop("Impact") * prop("Confidence") / prop("Effort")');
    });

    it('prefers the longest matching name', () => {
      expect(paste('Opportunity ID + Opportunity')).toBe('prop("Opportunity ID") + prop("Opportunity")');
    });

    it('matches names with spaces and non-Latin letters', () => {
      expect(paste('dateAdd(Due date, 1, "days")')).toBe('dateAdd(prop("Due date"), 1, "days")');
      expect(paste('状态 == "Done"')).toBe('prop("状态") == "Done"');
    });

    it('only matches whole words, with the exact case', () => {
      expect(paste('ImpactScore + impact + Impact2')).toBe('ImpactScore + impact + Impact2');
    });

    it('skips strings, comments and existing prop() arguments', () => {
      expect(paste('"Impact" + \'Effort\' /* Confidence */ + prop("Impact")')).toBe(
        '"Impact" + \'Effort\' /* Confidence */ + prop("Impact")'
      );
      expect(paste('"say \\"Impact\\"" + Impact')).toBe('"say \\"Impact\\"" + prop("Impact")');
    });

    it('does not touch calls, member access or names the language owns', () => {
      expect(paste('if(Impact > 1, "hi", "lo")')).toBe('if(prop("Impact") > 1, "hi", "lo")');
      expect(paste('Opportunity.length()')).toBe('prop("Opportunity").length()');
      expect(paste('current.Impact')).toBe('current.Impact');
      expect(paste('Impact (2)', ['Impact'])).toBe('Impact (2)');
    });

    it('leaves a name that several properties share', () => {
      expect(paste('Price + Cost', ['Price', 'Price', 'Cost'])).toBe('Price + prop("Cost")');
    });

    it('leaves variables bound by let() and lets()', () => {
      expect(paste('let(Impact, 2, Impact * Effort)')).toBe('let(Impact, 2, Impact * prop("Effort"))');
      expect(paste('lets(Impact, 2, Effort, Impact + 1, Effort * Confidence)')).toBe(
        'lets(Impact, 2, Effort, Impact + 1, Effort * prop("Confidence"))'
      );
      expect(paste('lets(a, Impact, a * 2)')).toBe('lets(a, prop("Impact"), a * 2)');
    });

    it('escapes quotes and backslashes in names', () => {
      expect(paste('Say "hi" + 1', ['Say "hi"'])).toBe('prop("Say \\"hi\\"") + 1');
    });

    it('works across lines', () => {
      expect(paste('Impact *\n  Confidence')).toBe('prop("Impact") *\n  prop("Confidence")');
    });
  });

  describe('curly quotes', () => {
    it('straightens curly quotes around prop() arguments', () => {
      expect(paste('prop(“Impact”) * prop(‘Effort’)')).toBe('prop("Impact") * prop("Effort")');
      expect(paste('prop( “Opportunity ID” )')).toBe('prop("Opportunity ID")');
    });

    it('leaves curly quotes elsewhere alone', () => {
      expect(paste('"He said “hi”" + 1')).toBe('"He said “hi”" + 1');
    });
  });
});

describe('normalizePastedFormula edge cases', () => {
  it.each([
    ['empty text', '', ''],
    ['whitespace only', '  \n\t', '  \n\t'],
    ['no property names at all', 'pi() * 2 ^ 3', 'pi() * 2 ^ 3'],
    ['operators with no spaces', 'Impact*Effort-Confidence', 'prop("Impact")*prop("Effort")-prop("Confidence")'],
    ['parentheses and unary minus', '-(Impact)', '-(prop("Impact"))'],
    ['list literals', '[Impact, Effort]', '[prop("Impact"), prop("Effort")]'],
    ['comparison and logic', 'Impact >= 3 and not Effort', 'prop("Impact") >= 3 and not prop("Effort")'],
    ['tabs and indentation', '\tImpact +\n\t\tEffort', '\tprop("Impact") +\n\t\tprop("Effort")'],
    ['a name at the very end', '1 + Effort', '1 + prop("Effort")'],
    ['a name followed by a method call', 'Opportunity ID.length()', 'prop("Opportunity ID").length()'],
    ['a name used as a function argument', 'round(Impact / Effort, 2)', 'round(prop("Impact") / prop("Effort"), 2)'],
    ['a longer name beside a shorter one', 'Due date + Due', 'prop("Due date") + Due'],
    ['a name that prefixes a longer word', 'Impactful + Impact_2', 'Impactful + Impact_2'],
    ['a name inside another word', 'preImpact', 'preImpact'],
    ['non-Latin letters beside a name', '状态值 + 状态', '状态值 + prop("状态")'],
  ])('%s', (_, text, expected) => {
    expect(paste(text)).toBe(expected);
  });

  it('matches names with punctuation and digits literally', () => {
    const names = ['Cost ($)', 'A+B', '2024 Revenue', 'Rate %'];

    expect(paste('Cost ($) * 2', names)).toBe('prop("Cost ($)") * 2');
    expect(paste('A+B - 1', names)).toBe('prop("A+B") - 1');
    expect(paste('2024 Revenue / 12', names)).toBe('prop("2024 Revenue") / 12');
    expect(paste('Rate % * 100', names)).toBe('prop("Rate %") * 100');
  });

  it('does not treat a name followed by "(" on the next line as a property', () => {
    expect(paste('Impact\n  (1)', ['Impact'])).toBe('Impact\n  (1)');
  });

  it('only reserves names in their exact case', () => {
    const names = ['Upper', 'True', 'upper', 'true'];

    expect(paste('Upper + upper("a") + True + true', names)).toBe('prop("Upper") + upper("a") + prop("True") + true');
  });

  it('skips names that are empty or padded with spaces', () => {
    expect(paste('Impact + Effort', ['', ' Impact', 'Effort '])).toBe('Impact + Effort');
  });

  it('leaves unterminated strings and comments alone', () => {
    expect(paste('Impact + "Effort')).toBe('prop("Impact") + "Effort');
    expect(paste('Impact /* Effort')).toBe('prop("Impact") /* Effort');
  });

  it('lets a string span lines, like the lexer', () => {
    expect(paste('"a\nImpact')).toBe('"a\nImpact');
    expect(paste('"a\nImpact" + 1')).toBe('"a\nImpact" + 1');
    expect(paste("'line one\nImpact' + Impact")).toBe('\'line one\nImpact\' + prop("Impact")');
  });

  it('keeps an explicit call after a multi-line string', () => {
    expect(paste('"Line 1\nPrice" + prop("Price")', ['Price'])).toBe('"Line 1\nPrice" + prop("Price")');
    expect(paste('if(prop("Done"), "Finished\nStatus ok", "Pending") + prop("Status")', ['Status', 'Done'])).toBe(
      'if(prop("Done"), "Finished\nStatus ok", "Pending") + prop("Status")'
    );
  });

  it('skips single-quoted strings with escaped quotes', () => {
    expect(paste("'it\\'s Impact' + Impact")).toBe("'it\\'s Impact' + prop(\"Impact\")");
  });

  it('converts every occurrence of a name', () => {
    expect(paste('Impact * Impact + Impact')).toBe('prop("Impact") * prop("Impact") + prop("Impact")');
  });

  it('handles a large formula quickly', () => {
    const names = Array.from({ length: 200 }, (_, index) => `Field ${index}`);
    const text = names.map((name) => `${name} * 2`).join(' +\n');
    const started = Date.now();

    expect(paste(text, names)).toBe(names.map((name) => `prop("${name}") * 2`).join(' +\n'));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  describe('variables', () => {
    it('leaves variables in nested let() calls', () => {
      expect(paste('let(Impact, 1, let(Effort, 2, Impact + Effort + Confidence))')).toBe(
        'let(Impact, 1, let(Effort, 2, Impact + Effort + prop("Confidence")))'
      );
    });

    it('converts properties in a let() value that is not a variable name', () => {
      expect(paste('let(x, Impact * 2, x + Effort)')).toBe('let(x, prop("Impact") * 2, x + prop("Effort"))');
    });

    it('does not treat a call or list in a lets() name slot as a variable', () => {
      expect(paste('lets(x, [Impact], y, round(Effort), x)')).toBe(
        'lets(x, [prop("Impact")], y, round(prop("Effort")), x)'
      );
    });

    it('keeps a variable name bare everywhere in the pasted text', () => {
      // One name cannot be both; it stays for the user to resolve.
      expect(paste('let(Impact, 1, Impact) + Impact')).toBe('let(Impact, 1, Impact) + Impact');
    });
  });

  describe('curly quotes', () => {
    it.each([
      ['double curly quotes', 'prop(“Impact”)', 'prop("Impact")'],
      ['single curly quotes', 'prop(‘Impact’)', 'prop("Impact")'],
      ['mismatched curly quotes', 'prop(“Impact’)', 'prop("Impact")'],
      ['padding inside the call', 'prop(  “Impact”  )', 'prop("Impact")'],
      ['a straight double quote inside the name', 'prop(“Say "hi"”)', 'prop("Say \\"hi\\"")'],
      ['a backslash inside the name', 'prop(“a\\b”)', 'prop("a\\\\b")'],
      ['several on one line', 'prop(“Impact”)*prop(“Effort”)', 'prop("Impact")*prop("Effort")'],
      ['a method-style call is still converted', 'x.prop(“Impact”)', 'x.prop("Impact")'],
    ])('%s', (_, text, expected) => {
      expect(paste(text)).toBe(expected);
    });

    it('does not join curly quotes across lines', () => {
      expect(paste('prop(“Impact\n”)')).toBe('prop(“Impact\n”)');
    });

    it('leaves other curly-quoted text alone', () => {
      expect(paste('“Impact” + Impact')).toBe('“Impact” + prop("Impact")');
      expect(paste('‘Effort’ + Effort')).toBe('‘Effort’ + prop("Effort")');
      expect(paste('it’s Impact')).toBe('it’s prop("Impact")');
    });

    it('does not touch a word ending in prop', () => {
      expect(paste('myprop(“Impact”)')).toBe('myprop(“Impact”)');
    });
  });
});

describe('explicit syntax in pasted text', () => {
  // Property names are free text, so one can be written like formula syntax.
  it.each([
    ['a name written as the call itself', 'prop("Price") * 2', ['Price', 'prop("Price")']],
    ['the same with no Price property', 'prop("Price") * 2', ['prop("Price")']],
    ['a name that opens the call', 'prop("Price") * 2', ['Price', 'prop(']],
    ['a name that stops inside the argument', 'prop("Price") * 2', ['Price', 'prop("Price']],
    ['a name that ends after the call', 'prop("Price") * 2', ['Price', 'prop("Price") *']],
    ['a name that starts at the closing parenthesis', 'prop("Price") * Qty', ['Price', ') * Qty']],
    ['a call with padding and a comment', 'prop /* p */ ( "Price" ) * 2', ['Price', 'prop /* p */ ( "Price" )']],
    ['an incomplete call', 'prop("Pri', ['prop("Pri']],
    ["a related row's call", 'current.prop("Price") * 2', ['Price', 'current.prop("Price")']],
    ['a whole formula of calls', 'prop("Price") * prop("Qty") + 1', ['Price', 'Qty', 'prop("Price") * prop("Qty")']],
    ['a name ending in a call inside a let body', 'let(x, 1, x + prop("Price"))', ['Price', 'x + prop("Price")']],
    ['a function call', 'now() + 1', ['now()']],
    ['a constant call', 'pi() * 2', ['pi()']],
    ['a name ending in "(" before a list', 'max([1, 2]) + 1', ['max(']],
    ['a name ending in "(" before a space', 'round( prop("Price"), 2)', ['Price', 'round(']],
    ['a name ending in "(" before a minus', 'abs(-3)', ['abs(']],
    ['a name ending in "(" before a string', 'upper("x")', ['upper(']],
    ['a name ending in "(" before a nested call', 'if((prop("Price") > 1), 1, 0)', ['Price', 'if(']],
  ])('keeps %s', (_, text, names) => {
    expect(paste(text, names)).toBe(text);
  });

  it('falls back to a shorter name that ends before the call', () => {
    expect(paste('Price + prop("Qty")', ['Price', 'Qty', 'Price + prop("Qty")'])).toBe('prop("Price") + prop("Qty")');
    expect(paste('Total round(Price)', ['Total', 'Price', 'Total round'])).toBe('prop("Total") round(prop("Price"))');
  });

  it('still wraps a name that only looks like a call of a word the language does not own', () => {
    expect(paste('Cost (USD) * 2', ['Cost (USD)'])).toBe('prop("Cost (USD)") * 2');
  });
});

describe('names that read as numbers or operators', () => {
  it.each([
    ['an integer', '2024 + 1', ['2024']],
    ['a number argument', 'dateAdd(now(), 7, "days")', ['7']],
    ['a decimal', 'x * 1.5', ['1.5']],
    ['the integer part of a decimal', 'x * 1.5', ['1']],
    ['an exponent', '1e3 + 1', ['1e3']],
    ['a capital exponent', '2E5 / 2', ['2E5']],
    ['the ternary ?', 'true ? 1 : 2', ['?']],
    ['the ternary :', 'true ? 1 : 2', [':']],
    ['&&', 'true && false', ['&&']],
    ['||', 'true || false', ['||']],
    ['a prefix !', '! true', ['!']],
    ['an operator the language owns', '10 % 3', ['%']],
  ])('keeps %s as written', (_, text, names) => {
    expect(paste(text, names)).toBe(text);
  });

  it('wraps a name beside a number that shares its digits', () => {
    expect(paste('if(Year == 2024, 1, 0)', ['Year', '2024'])).toBe('if(prop("Year") == 2024, 1, 0)');
    expect(paste('2024 Revenue - 2024', ['2024 Revenue', '2024'])).toBe('prop("2024 Revenue") - 2024');
    expect(paste('_ + 1', ['_'])).toBe('prop("_") + 1');
  });
});

describe('curly quotes inside literals', () => {
  it.each([
    ['a double-quoted string', '"say prop(“x”)" + 1'],
    ['a single-quoted string', "'say prop(“x”)' + 1"],
    ['a block comment', '/* prop(“x”) */ 1'],
    ['a string argument', 'concat(prop("Name"), " said prop(“x”)")'],
  ])('leaves prop(“x”) in %s alone', (_, text) => {
    expect(paste(text, ['Name', 'x'])).toBe(text);
    expect(paste(text, [])).toBe(text);
  });

  it('straightens curly quotes in code with no property names at all', () => {
    expect(paste('prop(“x”) + 1', [])).toBe('prop("x") + 1');
    expect(paste('"say prop(“x”)" + prop(“x”)', [])).toBe('"say prop(“x”)" + prop("x")');
    expect(paste('prop(“Tasks”).map(current.prop(“Hours”))', [])).toBe('prop("Tasks").map(current.prop("Hours"))');
  });
});

describe('pasting into an open string or comment', () => {
  const names = ['Done', 'Price', 'Due Date', 'Impact', 'x'];

  function pasteInto(text: string, context: string) {
    return normalizePastedFormula(text, names, { context });
  }

  it.each([
    ['after typing prop("', 'Due Date', '"'],
    ['between empty quotes', 'Done', '"'],
    ['in a single-quoted string', 'Done', "'"],
    ['in curly-quoted text', 'Done', '“'],
    ['in an open comment', 'Impact', '/*'],
    ['of a curly prop() call into a string', 'prop(“x”)', '"'],
    ['over several lines into a string', 'Done\nPrice', '"'],
  ])('leaves a paste %s as it is', (_, text, context) => {
    expect(pasteInto(text, context)).toBe(text);
  });

  it('reads what follows as code once the paste closes the literal', () => {
    expect(pasteInto('Done", Price', '"')).toBe('Done", prop("Price")');
    expect(pasteInto("Done' + Price", "'")).toBe('Done\' + prop("Price")');
    expect(pasteInto('Done */ Price', '/*')).toBe('Done */ prop("Price")');
    expect(pasteInto('Done” + Price', '“')).toBe('Done” + prop("Price")');
    expect(pasteInto('a\\\\" + Price', '"')).toBe('a\\\\" + prop("Price")');
  });

  it('keeps reading the string past an escaped quote', () => {
    expect(pasteInto('a\\" + Price', '"')).toBe('a\\" + Price');
  });

  it('pastes in code as before when there is no context', () => {
    expect(pasteInto('Due Date', '')).toBe('prop("Due Date")');
  });
});

describe('the characters right before the caret', () => {
  const names = ['Price', 'Status'];

  /** Pastes `text` after `before` the way the editor does. */
  function pasteAfter(before: string, text: string) {
    return normalizePastedFormula(text, names, { context: formulaPasteContext(before) });
  }

  it.each([
    ['after a backslash that escapes the pasted quote', 'concat("a\\', '" + Price'],
    ['after a "/" the pasted "*" makes a comment', '1 /', '* Price */'],
    ['onto the end of a word', 'x', 'Price'],
    ['after a dot, as a related row\'s property', 'current.', 'Status'],
    ['as a curly prop() call onto the end of a word', 'x', 'prop(“Price”)'],
  ])('leaves a paste %s as it is', (_, before, text) => {
    expect(pasteAfter(before, text)).toBe(text);
  });

  it('still reads the paste as code after an escaped backslash', () => {
    expect(pasteAfter('concat("a\\\\', '" + Price')).toBe('" + prop("Price")');
  });

  it('still rewrites a paste after a "/", a space or a closing parenthesis', () => {
    expect(pasteAfter('1 /', ' Price')).toBe(' prop("Price")');
    expect(pasteAfter('1 + ', 'Price')).toBe('prop("Price")');
    expect(pasteAfter('abs(1)', ' * Price')).toBe(' * prop("Price")');
    expect(pasteAfter('', 'prop(“Price”)')).toBe('prop("Price")');
    expect(pasteAfter('.5 +', 'current.prop(“Status”)')).toBe('current.prop("Status")');
  });

  it('names the opener of a literal the caret is in', () => {
    expect(formulaPasteContext('concat("a')).toBe('"');
    expect(formulaPasteContext("concat('a\\")).toBe("'\\");
    expect(formulaPasteContext('concat("a\\\\')).toBe('"');
    expect(formulaPasteContext('1 /* a *')).toBe('/*');
    expect(formulaPasteContext('“a\\')).toBe('“');
    expect(formulaPasteContext('1 + ')).toBe('');
    expect(formulaPasteContext('')).toBe('');
  });
});

describe('words reserved by the surrounding formula', () => {
  it('leaves variables bound around the paste bare', () => {
    const reservedWords = ['Impact'];

    expect(normalizePastedFormula('Impact * 2', ['Impact'], { reservedWords })).toBe('Impact * 2');
    expect(normalizePastedFormula('x + Impact + Effort', ['Impact', 'Effort'], { reservedWords })).toBe(
      'x + Impact + prop("Effort")'
    );
  });

  it('adds to the variables the pasted text binds itself', () => {
    expect(
      normalizePastedFormula('let(Effort, 1, Effort + Impact)', ['Impact', 'Effort'], { reservedWords: ['Impact'] })
    ).toBe('let(Effort, 1, Effort + Impact)');
  });
});

describe('formulaLiteralOpenerAt', () => {
  it('names the literal an offset sits in', () => {
    const source = 'if(prop("Status") == "", 1, 0) /* c */ + \'x\'';

    expect(formulaLiteralOpenerAt(source, 0)).toBe('');
    // Between the quotes of prop("Status") and of "".
    expect(formulaLiteralOpenerAt(source, 9)).toBe('"');
    expect(formulaLiteralOpenerAt(source, 22)).toBe('"');
    // Right after a closing quote is code again.
    expect(formulaLiteralOpenerAt(source, 23)).toBe('');
    expect(formulaLiteralOpenerAt(source, 34)).toBe('/*');
    expect(formulaLiteralOpenerAt(source, source.length - 1)).toBe("'");
    expect(formulaLiteralOpenerAt(source, source.length)).toBe('');
  });

  it('runs an unterminated literal to the end', () => {
    expect(formulaLiteralOpenerAt('prop("', 6)).toBe('"');
    expect(formulaLiteralOpenerAt('1 /* open', 9)).toBe('/*');
    expect(formulaLiteralOpenerAt('"done"', 6)).toBe('');
    expect(formulaLiteralOpenerAt('"say \\"', 7)).toBe('"');
  });

  it('follows strings across lines and curly text to the end of its line', () => {
    expect(formulaLiteralOpenerAt('"a\nb', 4)).toBe('"');
    expect(formulaLiteralOpenerAt('“a', 2)).toBe('“');
    expect(formulaLiteralOpenerAt('“a\nb', 4)).toBe('');
    expect(formulaLiteralOpenerAt('‘a’ + 1', 3)).toBe('');
  });

  it('reads the middle of a comment opener as code', () => {
    expect(formulaLiteralOpenerAt('1 /* c */', 3)).toBe('');
    expect(formulaLiteralOpenerAt('1 /* c */', 4)).toBe('/*');
  });
});
