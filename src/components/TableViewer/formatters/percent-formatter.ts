import { CellFormatter, FormatterOptions } from './formatter.interface';

export class PercentFormatter implements CellFormatter {
  readonly type = 'percent';
  readonly displayName = 'Percent';
  readonly description = 'Format numbers as percentages';
  readonly defaultOptions = {
    decimalPlaces: 1,
  };

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number') return String(value);
    
    const { decimalPlaces = 1 } = { ...this.defaultOptions, ...options };
    
    // If value is already in 0-1 range, multiply by 100
    // If value is in 0-100 range, use as-is
    // Otherwise, assume it's already a percentage
    let percentValue: number;
    if (value >= 0 && value <= 1) {
      percentValue = value * 100;
    } else if (value >= 0 && value <= 100) {
      percentValue = value;
    } else {
      // Assume it's already a percentage (e.g., 150 for 150%)
      percentValue = value;
    }
    
    return `${percentValue.toFixed(decimalPlaces)}%`;
  }

  canFormat(value: any): boolean {
    return typeof value === 'number';
  }

  getDefaultOptions(): FormatterOptions {
    return this.defaultOptions;
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      decimalPlaces: options.decimalPlaces ?? this.defaultOptions.decimalPlaces,
    };
  }
}

