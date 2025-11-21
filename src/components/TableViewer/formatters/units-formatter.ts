import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Units formatter - adds a unit suffix to numbers
 */
export class UnitsFormatter implements CellFormatter {
  readonly type = 'units';
  readonly displayName = 'Units';
  readonly description = 'Format numbers with a unit suffix (ft, m, lbs, etc.)';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    const opts = this.validateOptions(options || {});
    const unit = opts.unit || '';
    const decimalPlaces = opts.decimalPlaces ?? 0;
    const useGrouping = opts.useGrouping ?? false;
    
    const formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
      useGrouping,
    });
    
    return unit ? `${formatted} ${unit}` : formatted;
  }

  canFormat(value: any): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  getDefaultOptions(): FormatterOptions {
    return {
      unit: '',
      decimalPlaces: 0,
      useGrouping: false,
    };
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      unit: options.unit || '',
      decimalPlaces: Math.max(0, Math.min(20, options.decimalPlaces ?? 0)),
      useGrouping: options.useGrouping ?? false,
    };
  }
}

