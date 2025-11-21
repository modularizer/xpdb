import { CellFormatter, FormatterOptions } from './formatter.interface';

export class StarsFormatter implements CellFormatter {
  readonly type = 'stars';
  readonly displayName = 'Stars (Rating)';
  readonly description = 'Format numbers as star ratings (0-5 scale)';
  readonly defaultOptions = {
    maxStars: 5,
  };

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number') return String(value);
    
    const { maxStars = 5 } = { ...this.defaultOptions, ...options };
    
    // Clamp value to 0-maxStars range
    const clampedValue = Math.max(0, Math.min(maxStars, value));
    
    // Round to nearest 0.5 for half-star display
    const rounded = Math.round(clampedValue * 2) / 2;
    
    // Generate star string
    const fullStars = Math.floor(rounded);
    const hasHalfStar = rounded % 1 !== 0;
    const emptyStars = maxStars - fullStars - (hasHalfStar ? 1 : 0);
    
    return '★'.repeat(fullStars) + (hasHalfStar ? '½' : '') + '☆'.repeat(emptyStars);
  }

  canFormat(value: any): boolean {
    return typeof value === 'number';
  }

  getDefaultOptions(): FormatterOptions {
    return this.defaultOptions;
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      maxStars: options.maxStars ?? this.defaultOptions.maxStars,
    };
  }
}


