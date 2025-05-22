import Big from 'big.js';
import { currencyFormaterMap } from '@/application/database-yjs';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';

/**
 * Enhanced statistics calculator class with formatting capabilities
 * Handles precise calculations using big.js and supports formatting in various currencies
 */
export class EnhancedBigStats {
  private data: Big[];

  /**
   * Create a new statistics calculator instance
   * @param data - Array of number strings
   */
  constructor (data: string[] = []) {
    this.validateData(data);
    this.data = data.map(str => new Big(str));
  }

  /**
   * Parse a user input string into a fully expanded decimal number string
   * @param input - User input string or number which may contain various number formats
   * @param format - Optional number format to apply to the output
   * @returns Expanded decimal string without scientific notation, or null if parsing fails
   */
  static parse (input: string | number, format?: NumberFormat): string | null {
    if (!input || (typeof input !== 'string' && typeof input !== 'number')) {
      return null;
    }

    // Trim whitespace and remove currency symbols and separators
    const cleaned = input.toString().trim()
      // Remove all currency symbols, thousand separators, and other non-numeric characters
      // except for digits, period, plus, minus, and 'e' for scientific notation
      .replace(/[^0-9.e+-]/gi, '')
      // Replace multiple periods with a single one (keep only the first)
      .replace(/\.(?=.*\.)/g, '');

    if (!cleaned) {
      return null;
    }

    try {
      let bigNumber: Big;

      // Check if input is in scientific notation
      const scientificMatch = /^([0-9]+\.?[0-9]*)[eE]([+-]?[0-9]+)/.exec(cleaned);

      if (scientificMatch) {
        // Input is in scientific notation
        const base = scientificMatch[1];
        const exponent = parseInt(scientificMatch[2], 10);

        // Create Big instance from scientific notation
        bigNumber = new Big(`${base}e${exponent}`);
      } else {
        // Handle regular decimal numbers
        const decimalMatch = /^([+-]?[0-9]+\.?[0-9]*)/.exec(cleaned);

        if (decimalMatch) {
          bigNumber = new Big(decimalMatch[0]);
        } else {
          return null;
        }
      }

      // Fully expand the number to a decimal string without scientific notation
      // This special conversion ensures no scientific notation is used

      // Handle sign separately to avoid issues with toString
      const isNegative = bigNumber.lt(0);
      const absoluteValue = bigNumber.abs();

      // Convert to string and handle special cases
      let expandedStr: string;

      // For very large or very small numbers, we need special handling
      if (absoluteValue.e >= 21 || absoluteValue.e <= -7) {
        // Get the coefficient and exponent
        const c = absoluteValue.c; // Coefficient digits
        const e = absoluteValue.e; // Exponent

        if (e >= 0) {
          // Large number: add zeros to the right
          expandedStr = c.join('');
          // Pad with zeros if needed
          expandedStr = expandedStr.padEnd(e + 1, '0');
        } else {
          // Small number: add zeros to the left and decimal point
          expandedStr = '0.' + '0'.repeat(Math.abs(e) - 1) + c.join('');
        }
      } else {
        // For normal range numbers, Big.js toString already gives the right format
        expandedStr = absoluteValue.toString();
      }

      const res = isNegative ? '-' + expandedStr : expandedStr;

      // If a format is specified, apply formatting
      if (format !== undefined) {
        return EnhancedBigStats.formatValue(res, format);
      }

      // Add sign back if negative
      return res;
    } catch (error) {
      // Return null if Big.js couldn't parse the value
      return null;
    }
  }

  /**
   * Format a number value using the specified number format
   * @param numberValue - The number value to format (as string or Big)
   * @param format - The number format to use
   * @returns Formatted string representation
   */
  static formatValue (numberValue: string | Big | number, format: NumberFormat = NumberFormat.Num): string {
    // Convert input to string for processing
    const valueStr = numberValue.toString();

    // Use the formatter from the map
    const formatter = currencyFormaterMap[format];

    if (!formatter) {
      return valueStr;
    }

    try {
      // Check if the value is an integer (no decimal point or all zeros after decimal)
      const isInteger = !valueStr.includes('.') ||
        new Big(valueStr).mod(1).eq(0);

      if (isInteger) {
        try {
          // For integers, try to use BigInt for maximum precision
          // Remove any decimal part that is all zeros
          const cleanedInt = valueStr.includes('.')
            ? valueStr.slice(0, valueStr.indexOf('.'))
            : valueStr;

          return formatter(BigInt(cleanedInt));
        } catch (e) {
          // If BigInt conversion fails (e.g., too large), fall back to Number
          console.warn('BigInt conversion failed, falling back to Number:', e);
        }
      }

      // Check if the number is within safe JavaScript number range
      return formatter(parseFloat(valueStr));
    } catch (error) {
      console.error('Error in formatValue:', error);
      // Return original string in case of error
      return valueStr;
    }
  }

  /**
   * Compare two number strings
   * @param a - First number string
   * @param b - Second number string
   * @returns Comparison result: -1 if a < b, 1 if a > b, 0 if equal
   */
  static compare (a: string, b: string): number {
    const numA = new Big(a);
    const numB = new Big(b);

    if (numA.lt(numB)) return -1;
    if (numA.gt(numB)) return 1;
    return 0;
  }

  /**
   * Validate input data
   * @param data - Data to be validated
   * @private
   */
  private validateData (data: string[]): void {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array');
    }

    // Verify each element is a valid number string
    for (const item of data) {
      try {
        // Try to create a Big instance to validate
        new Big(item);
      } catch (e) {
        throw new Error(`Invalid number format: ${item}`);
      }
    }
  }

  /**
   * Calculate sum of the data
   * @returns Total sum
   */
  sum (): Big {
    if (this.data.length === 0) return new Big(0);

    return this.data.reduce((acc, val) => acc.plus(val), new Big(0));
  }

  /**
   * Calculate average of the data
   * @returns Average value
   */
  average (): Big {
    if (this.data.length === 0) {
      throw new Error('Cannot calculate average of empty dataset');
    }

    const sum = this.sum();

    return sum.div(new Big(this.data.length));
  }

  /**
   * Find maximum value in the data
   * @returns Maximum value
   */
  max (): Big {
    if (this.data.length === 0) {
      throw new Error('Cannot find maximum of empty dataset');
    }

    return this.data.reduce((max, val) => (val.gt(max) ? val : max), this.data[0]);
  }

  /**
   * Find minimum value in the data
   * @returns Minimum value
   */
  min (): Big {
    if (this.data.length === 0) {
      throw new Error('Cannot find minimum of empty dataset');
    }

    return this.data.reduce((min, val) => (val.lt(min) ? val : min), this.data[0]);
  }

  /**
   * Calculate median of the data
   * @returns Median value
   */
  median (): Big {
    if (this.data.length === 0) {
      throw new Error('Cannot calculate median of empty dataset');
    }

    // Create a sorted copy of the array
    const sorted = [...this.data].sort((a, b) => {
      if (a.lt(b)) return -1;
      if (a.gt(b)) return 1;
      return 0;
    });

    const len = sorted.length;

    if (len % 2 === 1) {
      // Odd length: return middle element
      return sorted[Math.floor(len / 2)];
    } else {
      // Even length: return average of two middle elements
      const mid1 = sorted[len / 2 - 1];
      const mid2 = sorted[len / 2];

      return mid1.plus(mid2).div(2);
    }
  }

  /**
   * Calculate variance of the data
   * @returns Variance
   */
  variance (): Big {
    if (this.data.length <= 1) {
      throw new Error('Need at least two data points to calculate variance');
    }

    const avg = this.average();
    const squaredDiffs = this.data.map(val => {
      const diff = val.minus(avg);

      return diff.times(diff);
    });

    const sumSquaredDiffs = squaredDiffs.reduce((acc, val) => acc.plus(val), new Big(0));

    return sumSquaredDiffs.div(new Big(this.data.length));
  }

  /**
   * Calculate standard deviation of the data
   * @returns Standard deviation
   */
  standardDeviation (): Big {
    const variance = this.variance();

    // Initial guess
    let x = new Big(variance.toString());

    // Iterate 10 times (usually sufficient to converge to a precise approximation)
    for (let i = 0; i < 10; i++) {
      x = x.plus(variance.div(x)).div(2);
    }

    return x;
  }

  /**
   * Return all calculation results with optional formatting
   * @param decimalPlaces - Number of decimal places to keep in raw values
   * @param format - Number format to use for formatted values
   * @returns All statistical values with both raw and formatted representations
   */
  getStats (decimalPlaces: number = 4, format: NumberFormat = NumberFormat.Num): {
    count: number;
    sum: { raw: string; formatted: string };
    average: { raw: string; formatted: string };
    median: { raw: string; formatted: string };
    min: { raw: string; formatted: string };
    max: { raw: string; formatted: string };
    range: { raw: string; formatted: string };
    variance: { raw: string; formatted: string } | null;
    standardDeviation: { raw: string; formatted: string } | null;
  } {
    const DP = Big.DP;

    // Temporarily set precision
    Big.DP = decimalPlaces;

    try {
      const sum = this.sum();
      const average = this.data.length > 0 ? this.average() : new Big(0);
      const median = this.data.length > 0 ? this.median() : new Big(0);
      const min = this.data.length > 0 ? this.min() : new Big(0);
      const max = this.data.length > 0 ? this.max() : new Big(0);
      const range = this.data.length > 0 ? max.minus(min) : new Big(0);

      let variance = null;
      let standardDeviation = null;

      if (this.data.length > 1) {
        variance = this.variance();
        standardDeviation = this.standardDeviation();
      }

      return {
        count: this.data.length,
        sum: {
          raw: sum.toString(),
          formatted: EnhancedBigStats.formatValue(sum, format),
        },
        average: {
          raw: average.toString(),
          formatted: EnhancedBigStats.formatValue(average, format),
        },
        median: {
          raw: median.toString(),
          formatted: EnhancedBigStats.formatValue(median, format),
        },
        min: {
          raw: min.toString(),
          formatted: EnhancedBigStats.formatValue(min, format),
        },
        max: {
          raw: max.toString(),
          formatted: EnhancedBigStats.formatValue(max, format),
        },
        range: {
          raw: range.toString(),
          formatted: EnhancedBigStats.formatValue(range, format),
        },
        variance: variance ? {
          raw: variance.toString(),
          formatted: EnhancedBigStats.formatValue(variance, format),
        } : null,
        standardDeviation: standardDeviation ? {
          raw: standardDeviation.toString(),
          formatted: EnhancedBigStats.formatValue(standardDeviation, format),
        } : null,
      };
    } finally {
      // Restore original precision setting
      Big.DP = DP;
    }
  }

  /**
   * Format a specific statistic with the given number format
   * @param statMethod - Method that returns the statistic to format
   * @param format - Number format to use
   * @returns Formatted string representation of the statistic
   */
  formatStat (statMethod: () => Big, format: NumberFormat): string {
    try {
      const value = statMethod.call(this);

      return EnhancedBigStats.formatValue(value, format);
    } catch (error) {
      return 'N/A';
    }
  }

  /**
   * Get formatted sum
   * @param format - Number format to use
   * @returns Formatted sum
   */
  formattedSum (format: NumberFormat = NumberFormat.Num): string {
    return this.formatStat(() => this.sum(), format);
  }

  /**
   * Get formatted average
   * @param format - Number format to use
   * @returns Formatted average
   */
  formattedAverage (format: NumberFormat = NumberFormat.Num): string {
    return this.formatStat(() => this.average(), format);
  }

  /**
   * Get formatted median
   * @param format - Number format to use
   * @returns Formatted median
   */
  formattedMedian (format: NumberFormat = NumberFormat.Num): string {
    return this.formatStat(() => this.median(), format);
  }

  /**
   * Get formatted minimum
   * @param format - Number format to use
   * @returns Formatted minimum
   */
  formattedMin (format: NumberFormat = NumberFormat.Num): string {
    return this.formatStat(() => this.min(), format);
  }

  /**
   * Get formatted maximum
   * @param format - Number format to use
   * @returns Formatted maximum
   */
  formattedMax (format: NumberFormat = NumberFormat.Num): string {
    return this.formatStat(() => this.max(), format);
  }

  /**
   * Add a new data point
   * @param value - Number string to be added
   */
  addDataPoint (value: string): void {
    try {
      const bigValue = new Big(value);

      this.data.push(bigValue);
    } catch (e) {
      throw new Error(`Invalid number format: ${value}`);
    }
  }

  /**
   * Add a new data point by parsing a user input string
   * @param input - User input string to parse and add
   * @returns Boolean indicating if the addition was successful
   */
  addParsedDataPoint (input: string): boolean {
    const parsedValue = EnhancedBigStats.parse(input);

    if (parsedValue === null) {
      return false;
    }

    try {
      this.addDataPoint(parsedValue);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Clear the dataset
   */
  clearData (): void {
    this.data = [];
  }

  /**
   * Set a new dataset
   * @param data - New dataset
   */
  setData (data: string[]): void {
    this.validateData(data);
    this.data = data.map(str => new Big(str));
  }

  /**
   * Set new data by parsing an array of user input strings
   * @param inputs - Array of user input strings
   * @returns Number of successfully parsed values
   */
  setParsedData (inputs: string[]): number {
    if (!Array.isArray(inputs)) {
      return 0;
    }

    const parsedValues: string[] = [];
    let successCount = 0;

    for (const input of inputs) {
      const parsedValue = EnhancedBigStats.parse(input);

      if (parsedValue !== null) {
        parsedValues.push(parsedValue);
        successCount++;
      }
    }

    if (parsedValues.length > 0) {
      this.setData(parsedValues);
    }

    return successCount;
  }

  /**
   * Get the raw data as Big instances
   * @returns Array of Big numbers
   */
  getRawData (): Big[] {
    return [...this.data];
  }

  /**
   * Get formatted data array
   * @param format - Number format to use
   * @returns Array of formatted values
   */
  getFormattedData (format: NumberFormat = NumberFormat.Num): string[] {
    return this.data.map(value => EnhancedBigStats.formatValue(value, format));
  }

}

export default EnhancedBigStats;