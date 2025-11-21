import { CellFormatter, FormatterOptions } from './formatter.interface';
import { formatterRegistry } from './formatter-registry';

/**
 * Auto formatter that detects the best format based on data
 */
export class AutoFormatter implements CellFormatter {
  readonly type = 'auto';
  readonly displayName = 'Auto (detect from data)';
  readonly description = 'Automatically detect the best format from the data';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number') return String(value);
    
    // Use auto-detection logic to determine best formatter
    // For now, fall back to default number formatting
    return value.toLocaleString('en-US');
  }

  canFormat(value: any): boolean {
    return true; // Auto can handle any value
  }

  getDefaultOptions(): FormatterOptions {
    return {};
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {};
  }
}

/**
 * Auto-detect the best formatter for a column based on its values, name, data type, and available width
 * @param values - Array of all values in the column
 * @param columnName - Name of the column (for name-based detection)
 * @param dataType - Database data type (e.g., 'integer', 'numeric', 'enum', 'timestamp', etc.)
 * @param columnWidth - Width of the column in pixels (for space-aware formatting)
 * @returns Suggested formatter type
 */
export function autoDetectFormatter(
  values: any[],
  columnName: string,
  dataType?: string,
  columnWidth?: number
): { type: string; options?: FormatterOptions } {
  const lowerName = columnName.toLowerCase();
  const lowerDataType = dataType?.toLowerCase() || '';
  
  // Check data type first (most reliable) - this must be checked BEFORE numeric analysis
  if (lowerDataType.includes('enum')) {
    // Enums should be displayed as plain strings
    return { type: 'plain' };
  }
  
  // Check for date/timestamp types - this must happen BEFORE numeric value analysis
  // Also check column name for date-related patterns
  if (lowerDataType.includes('timestamp') || lowerDataType.includes('date') || lowerDataType.includes('time') ||
      lowerName.includes('timestamp') || lowerName.includes('date') || lowerName.includes('time') ||
      lowerName.includes('created') || lowerName.includes('updated') || lowerName.includes('modified')) {
    // Dates/timestamps should use date formatter
    return { type: 'date', options: { dateFormat: 'M/D/Y', timeFormat: '12h', showTime: true, showSeconds: false, timezone: 'local' } };
  }
  
  // Analyze numeric values first (needed for some checks)
  const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v) && v !== null && v !== undefined);
  
  // Check if numeric values look like timestamps (Unix timestamps are typically 10-13 digits, representing seconds or milliseconds since epoch)
  // Common timestamp ranges: 946684800 (2000-01-01) to 4102444800 (2100-01-01) in seconds
  // Or in milliseconds: 946684800000 to 4102444800000
  if (numericValues.length > 0) {
    const allNumeric = values.every(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))));
    if (allNumeric && numericValues.length > 0) {
      const minValue = Math.min(...numericValues);
      const maxValue = Math.max(...numericValues);
      // Check if values are in timestamp range (seconds: 946684800 to 4102444800, or milliseconds: 946684800000 to 4102444800000)
      const isTimestampRange = (minValue >= 946684800 && maxValue <= 4102444800) || 
                              (minValue >= 946684800000 && maxValue <= 4102444800000);
      // Also check if column name suggests timestamp
      if (isTimestampRange && (lowerName.includes('timestamp') || lowerName.includes('date') || lowerName.includes('time') ||
          lowerName.includes('created') || lowerName.includes('updated') || lowerName.includes('modified'))) {
        return { type: 'date', options: { dateFormat: 'M/D/Y', timeFormat: '12h', showTime: true, showSeconds: false, timezone: 'local' } };
      }
    }
  }
  
  // Check column name for hints (before analyzing values)
  // Year detection (highest priority for name-based detection)
  if (lowerName.includes('yr') || lowerName.includes('year')) {
    return { type: 'year' };
  }
  
  // Percent detection
  if (lowerName.includes('pct') || lowerName.includes('percent') || lowerName.includes('%')) {
    return { type: 'percent', options: { decimalPlaces: 1 } };
  }
  
  // Currency detection
  if (lowerName.includes('price') || lowerName.includes('cost') || 
      lowerName.includes('amount') || lowerName.includes('revenue') ||
      lowerName.includes('salary') || lowerName.includes('wage') ||
      lowerName.includes('fee') || lowerName.includes('payment')) {
    return { type: 'currency', options: { currencySymbol: '$', decimalPlaces: 2, useGrouping: true } };
  }
  
  // Rating/Stars detection (check if values are in 0-5 range)
  if (numericValues.length > 0) {
    const minValue = Math.min(...numericValues);
    const maxValue = Math.max(...numericValues);
    const isRatingRange = minValue >= 0 && maxValue <= 5;
    const isLikelyRating = lowerName.includes('rating') || lowerName.includes('rate') || 
                          lowerName.includes('score') || lowerName.includes('star');
    
    if (isRatingRange && (isLikelyRating || numericValues.every(v => v >= 0 && v <= 5 && Number.isInteger(v * 2)))) {
      // Check if most values are integers or half-integers (0, 0.5, 1, 1.5, etc.)
      const halfIntegerCount = numericValues.filter(v => {
        const doubled = v * 2;
        return Number.isInteger(doubled) && doubled >= 0 && doubled <= 10;
      }).length;
      
      if (halfIntegerCount / numericValues.length > 0.8) {
        return { type: 'stars', options: { maxStars: 5 } };
      }
    }
  }
  
  if (numericValues.length === 0) {
    return { type: 'auto' };
  }
  
  // Check data type for integer hints
  if (lowerDataType.includes('int') && !lowerDataType.includes('decimal') && !lowerDataType.includes('numeric') && !lowerDataType.includes('float') && !lowerDataType.includes('double')) {
    // Integer types - check if they look like years
    const allWhole = numericValues.every(v => Number.isInteger(v));
    if (allWhole) {
      // Check if values are in a reasonable year range (e.g., 1000-3000)
      const minYear = Math.min(...numericValues);
      const maxYear = Math.max(...numericValues);
      if (minYear >= 1000 && maxYear <= 3000 && numericValues.length > 0) {
        // If column name suggests year, use year format (no commas)
        if (lowerName.includes('yr') || lowerName.includes('year')) {
          return { type: 'year' };
        }
        // Otherwise use commas for integers
        return { type: 'commas', options: { decimalPlaces: 0, useGrouping: true } };
      }
      // Regular integers
      return { type: 'commas', options: { decimalPlaces: 0, useGrouping: true } };
    }
  }
  
  // Check for very large or very small numbers
  const maxAbs = Math.max(...numericValues.map(v => Math.abs(v)));
  const minAbs = numericValues.filter(v => v !== 0).length > 0 
    ? Math.min(...numericValues.filter(v => v !== 0).map(v => Math.abs(v)))
    : 1;
  
  // Estimate character width needed for different formats
  // Rough estimate: ~8-10 pixels per character for monospace font
  const charWidth = 9;
  const availableChars = columnWidth ? Math.floor((columnWidth - 20) / charWidth) : 20; // Subtract padding
  
  // Check if values would overflow with comma formatting
  const maxValueWithCommas = maxAbs.toLocaleString('en-US', { useGrouping: true });
  const maxValueWithSuffix = maxAbs >= 1e12 ? `${(maxAbs / 1e12).toFixed(2)}T` :
                             maxAbs >= 1e9 ? `${(maxAbs / 1e9).toFixed(2)}B` :
                             maxAbs >= 1e6 ? `${(maxAbs / 1e6).toFixed(2)}M` :
                             maxAbs >= 1e3 ? `${(maxAbs / 1e3).toFixed(2)}k` :
                             String(maxAbs);
  
  // If any value has > 7 digits of precision, suggest suffix notation
  // Also prefer suffix notation if column is narrow and values are large
  const needsSuffixForPrecision = maxAbs >= 10000000 || (minAbs > 0 && minAbs < 0.0000001);
  const needsSuffixForSpace = columnWidth && maxValueWithCommas.length > availableChars && maxValueWithSuffix.length <= availableChars;
  
  if (needsSuffixForPrecision || needsSuffixForSpace) {
    return { type: 'suffixes' };
  }
  
  // Check if all values are whole numbers
  const allWhole = numericValues.every(v => Number.isInteger(v));
  if (allWhole) {
    // For whole numbers, check if they're in year range
    // IMPORTANT: Year columns should NEVER get commas, regardless of value range
    if (lowerName.includes('yr') || lowerName.includes('year')) {
      return { type: 'year' };
    }
    return { type: 'commas', options: { decimalPlaces: 0, useGrouping: true } };
  }
  
  // Default to commas with decimals
  return { type: 'commas', options: { decimalPlaces: 2, useGrouping: true } };
}

