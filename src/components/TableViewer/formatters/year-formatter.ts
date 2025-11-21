import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Year formatter - plain numbers without commas
 */
export class YearFormatter implements CellFormatter {
  readonly type = 'year';
  readonly displayName = 'Year (no commas)';
  readonly description = 'Format as year - plain number without thousands separator';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    return String(value);
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


