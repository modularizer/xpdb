import React from 'react';
import { Text } from 'react-native';
import { CellFormatter, FormatterOptions, FormattedCellResult, CellRenderProps } from './formatter.interface';

/**
 * Commas formatter - numbers with thousands separator
 */
export class CommasFormatter implements CellFormatter {
  readonly type = 'commas';
  readonly displayName = 'Commas (thousands separator)';
  readonly description = 'Format numbers with thousands separator (commas)';

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
    const decimals = opts.decimalPlaces ?? 0;
    const useGrouping = opts.useGrouping ?? true;
    
    return value.toLocaleString('en-US', {
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
      decimalPlaces: 0,
      useGrouping: true,
    };
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    return {
      decimalPlaces: Math.max(0, Math.min(20, options.decimalPlaces ?? 0)),
      useGrouping: options.useGrouping ?? true,
    };
  }
}


