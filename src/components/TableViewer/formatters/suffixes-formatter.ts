import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Suffix notation formatter (k, M, B, T, etc.)
 */
export class SuffixesFormatter implements CellFormatter {
  readonly type = 'suffixes';
  readonly displayName = 'Suffixes (k, M, B, etc.)';
  readonly description = 'Format large numbers with suffixes (k for thousands, M for millions, etc.)';

  format(value: any, options?: FormatterOptions): string | { number: string; suffix: string } {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    
    if (absValue >= 1e12) {
      // Trillions
      return { number: `${sign}${(absValue / 1e12).toFixed(2)}`, suffix: 'T' };
    } else if (absValue >= 1e9) {
      // Billions
      return { number: `${sign}${(absValue / 1e9).toFixed(2)}`, suffix: 'B' };
    } else if (absValue >= 1e6) {
      // Millions
      return { number: `${sign}${(absValue / 1e6).toFixed(2)}`, suffix: 'M' };
    } else if (absValue >= 1e3) {
      // Thousands
      return { number: `${sign}${(absValue / 1e3).toFixed(2)}`, suffix: 'k' };
    } else if (absValue >= 1) {
      // Regular numbers >= 1
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    } else if (absValue >= 1e-3) {
      // Millis (0.001 to 0.999)
      return value.toFixed(2);
    } else if (absValue >= 1e-6) {
      // Micros (0.000001 to 0.000999)
      return { number: `${sign}${(absValue * 1e6).toFixed(2)}`, suffix: 'μ' };
    } else if (absValue >= 1e-9) {
      // Nanos (0.000000001 to 0.000000999)
      return { number: `${sign}${(absValue * 1e9).toFixed(2)}`, suffix: 'n' };
    } else {
      // Very small numbers - use scientific notation as fallback
      return value.toExponential(2);
    }
  }

  canFormat(value: any): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  getDefaultOptions(): FormatterOptions {
    return {};
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {};
  }
}


