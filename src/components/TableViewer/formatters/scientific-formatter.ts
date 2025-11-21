import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Scientific notation formatter
 */
export class ScientificFormatter implements CellFormatter {
  readonly type = 'scientific';
  readonly displayName = 'Scientific Notation';
  readonly description = 'Format numbers in scientific notation (e.g., 1.23e+5)';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    const opts = this.validateOptions(options || {});
    const decimals = opts.decimalPlaces ?? 2;
    
    return value.toExponential(decimals);
  }

  canFormat(value: any): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  getDefaultOptions(): FormatterOptions {
    return {
      decimalPlaces: 2,
    };
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      decimalPlaces: Math.max(0, Math.min(20, options.decimalPlaces ?? 2)),
    };
  }
}


