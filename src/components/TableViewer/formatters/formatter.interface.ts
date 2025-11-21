/**
 * Interface for all cell formatters
 * Each formatter must implement this interface to be used in the table
 */
export interface CellFormatter {
  /** Unique identifier for this formatter type */
  readonly type: string;
  
  /** Display name shown in the UI */
  readonly displayName: string;
  
  /** Description shown in the UI */
  readonly description: string;
  
  /**
   * Format a value for display
   * @param value - The value to format
   * @param options - Formatting options specific to this formatter
   * @returns Formatted string representation
   */
  format(value: any, options?: FormatterOptions): string | { number: string; suffix: string };
  
  /**
   * Check if this formatter can handle the given value
   * @param value - The value to check
   * @returns True if this formatter can format the value
   */
  canFormat(value: any): boolean;
  
  /**
   * Get default options for this formatter
   * @returns Default options
   */
  getDefaultOptions(): FormatterOptions;
  
  /**
   * Validate and normalize options for this formatter
   * @param options - Options to validate
   * @returns Validated and normalized options
   */
  validateOptions(options: Partial<FormatterOptions>): FormatterOptions;
  
  /**
   * Optional: Render UI for configuring formatter options
   * @param props - Props for rendering options UI
   * @returns React node for options UI
   */
  renderOptions?(props: FormatterOptionProps): React.ReactNode;
}

/**
 * Options that can be passed to formatters
 */
export interface FormatterOptions {
  /** Currency symbol (for currency formatter) */
  currencySymbol?: string;
  
  /** Number of decimal places */
  decimalPlaces?: number;
  
  /** Whether to use thousands separator (commas) */
  useGrouping?: boolean;
  
  /** Custom options specific to formatter */
  [key: string]: any;
}

/**
 * Props for rendering formatter options UI
 */
export interface FormatterOptionProps extends FormatterOptions {
  setCurrencySymbol: (symbol: string) => void;
  setDecimalPlaces: (places: number) => void;
  setUseGrouping: (use: boolean) => void;
}

/**
 * Configuration for a column's formatting
 */
export interface ColumnFormatConfig {
  /** Formatter type identifier */
  type: string;
  
  /** Options for the formatter */
  options?: FormatterOptions;
}

