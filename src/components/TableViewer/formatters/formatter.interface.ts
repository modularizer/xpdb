import React from 'react';
import { StyleSheet } from 'react-native';

/**
 * Result from rendering a formatted cell
 */
export interface FormattedCellResult {
  /** React element to display in the table */
  element: React.ReactNode;
  /** String representation for CSV export */
  stringValue: string;
}

/**
 * Props for rendering a cell
 */
export interface CellRenderProps {
  value: any;
  options?: FormatterOptions;
  styles: ReturnType<typeof StyleSheet.create>;
  isNull?: boolean;
}

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
   * Render a cell with both React element and string representation
   * @param props - Props for rendering the cell
   * @returns Object with both the React element and string representation
   */
  renderCell(props: CellRenderProps): FormattedCellResult;
  
  /**
   * Format a value for display (legacy method, kept for backward compatibility)
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
export interface FormatterOptionProps {
  options: FormatterOptions;
  setOptions: (options: FormatterOptions) => void;
  styles: ReturnType<typeof StyleSheet.create>;
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

