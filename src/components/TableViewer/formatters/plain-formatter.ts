import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Plain number formatter - no formatting, just the number
 */
export class PlainFormatter implements CellFormatter {
  readonly type = 'plain';
  readonly displayName = 'Plain Number';
  readonly description = 'Format as plain number with optional decimal places';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    const opts = this.validateOptions(options || {});
    
    if (opts.decimalPlaces !== undefined) {
      return value.toFixed(opts.decimalPlaces);
    }
    
    return String(value);
  }

  canFormat(value: any): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  getDefaultOptions(): FormatterOptions {
    return {};
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      decimalPlaces: options.decimalPlaces !== undefined 
        ? Math.max(0, Math.min(20, options.decimalPlaces))
        : undefined,
    };
  }
}


