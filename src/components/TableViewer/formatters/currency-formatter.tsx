import React from 'react';
import { Text } from 'react-native';
import { CellFormatter, FormatterOptions, FormattedCellResult, CellRenderProps } from './formatter.interface';

/**
 * Currency formatter
 */
export class CurrencyFormatter implements CellFormatter {
  readonly type = 'currency';
  readonly displayName = 'Currency';
  readonly description = 'Format as currency with symbol and decimal places';

  renderCell(props: CellRenderProps): FormattedCellResult {
    const { value, options, styles, isNull } = props;
    
    if (isNull || value === null || value === undefined) {
      return {
        element: <Text style={[styles.tableCellText, styles.nullValueText]}>?</Text>,
        stringValue: '',
      };
    }
    
    const formatted = this.format(value, options);
    const stringValue = String(formatted);
    
    return {
      element: <Text style={styles.tableCellText} selectable={true}>{formatted}</Text>,
      stringValue,
    };
  }

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number' || isNaN(value)) return String(value);
    
    const opts = this.validateOptions(options || {});
    const symbol = opts.currencySymbol || '$';
    const decimals = opts.decimalPlaces ?? 2;
    const useGrouping = opts.useGrouping ?? true;
    
    return symbol + value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping,
    });
  }

  canFormat(value: any): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  getDefaultOptions(): FormatterOptions {
    return {
      currencySymbol: '$',
      decimalPlaces: 2,
      useGrouping: true,
    };
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      currencySymbol: options.currencySymbol || '$',
      decimalPlaces: Math.max(0, Math.min(20, options.decimalPlaces ?? 2)),
      useGrouping: options.useGrouping ?? true,
    };
  }
}


