import { normalizePastedFormula } from '../formula-paste';

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

  it('ends a string at a line break, like the lexer', () => {
    expect(paste('"a\nImpact')).toBe('"a\nprop("Impact")');
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
