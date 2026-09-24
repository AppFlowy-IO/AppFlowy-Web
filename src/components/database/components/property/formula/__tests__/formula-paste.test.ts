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
