/**
 * Utility functions for TableViewer
 */

import type { TableViewerColumn } from './types';

/**
 * Check if value looks like a date
 */
export function isDateValue(value: any): boolean {
  if (value instanceof Date) return true;
  if (typeof value === 'string') {
    // Check if it's a date string (ISO format, or common date formats)
    const dateRegex = /^\d{4}-\d{2}-\d{2}/; // ISO date
    const dateTimeRegex = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/; // ISO datetime
    if (dateRegex.test(value) || dateTimeRegex.test(value)) {
      const date = new Date(value);
      return !isNaN(date.getTime());
    }
  }
  if (typeof value === 'number') {
    // Could be a timestamp
    const date = new Date(value);
    return !isNaN(date.getTime()) && value > 0 && value < 1e15; // Reasonable timestamp range
  }
  return false;
}

/**
 * Detect if a value is a color (hex, rgb, rgba, etc.)
 */
export function isColorValue(value: any): boolean {
  if (typeof value !== 'string') return false;
  const str = value.trim().toLowerCase();
  
  // Hex colors: #rgb, #rrggbb, #rrggbbaa
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(str)) return true;
  
  // rgb/rgba colors: rgb(255, 255, 255) or rgba(255, 255, 255, 0.5)
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(str)) return true;
  
  // Named colors (basic set)
  const namedColors = ['red', 'green', 'blue', 'black', 'white', 'yellow', 'cyan', 'magenta', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey'];
  if (namedColors.includes(str)) return true;
  
  return false;
}

/**
 * Parse color value to hex for rendering
 */
export function parseColorToHex(value: string): string {
  const str = value.trim().toLowerCase();
  
  // Already hex
  if (str.startsWith('#')) {
    // Expand short hex (#rgb -> #rrggbb)
    if (str.length === 4) {
      return '#' + str[1] + str[1] + str[2] + str[2] + str[3] + str[3];
    }
    return str.substring(0, 7); // Take only RGB, ignore alpha
  }
  
  // rgb/rgba
  const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  
  // Named colors
  const colorMap: Record<string, string> = {
    red: '#ff0000', green: '#00ff00', blue: '#0000ff', black: '#000000',
    white: '#ffffff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
    orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
    gray: '#808080', grey: '#808080'
  };
  return colorMap[str] || '#000000';
}

/**
 * Detect if a value is a URL
 */
export function isURLValue(value: any): boolean {
  if (typeof value !== 'string') return false;
  const str = value.trim();
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:';
  } catch {
    // Also check for common URL patterns without protocol
    return /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/.*)?$/i.test(str) ||
           /^www\.[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/.*)?$/i.test(str);
  }
}

/**
 * Normalize URL (add protocol if missing)
 */
export function normalizeURL(value: string): string {
  const str = value.trim();
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('ftp://')) {
    return str;
  }
  if (str.startsWith('www.')) {
    return 'https://' + str;
  }
  return 'https://' + str;
}

/**
 * Check if column is an enum type
 */
export function isEnumColumn(column: TableViewerColumn | undefined): boolean {
  if (!column) return false;
  const lowerDataType = column.dataType?.toLowerCase() || '';
  return lowerDataType.includes('enum');
}

/**
 * Generate a color for enum value (consistent hash-based color)
 */
export function getEnumColor(value: string): string {
  // Simple hash function to generate consistent colors
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  // Use HSL with fixed saturation and lightness for good visibility
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Estimate text width in pixels (rough approximation)
 */
export function estimateTextWidth(text: string, fontSize: number = 12): number {
  // Rough approximation: average character width is about 0.6 * fontSize for monospace
  // Add some padding
  return text.length * fontSize * 0.6 + 20;
}

/**
 * Calculate optimal column width based on header and cell content
 */
export function calculateOptimalColumnWidth(
  headerText: string,
  cellValues: any[],
  minWidth: number = 90,
  maxWidth: number = 270,
  defaultWidth: number = 180
): number {
  const headerWidth = estimateTextWidth(headerText, 14);
  
  // Find the longest cell value (as string)
  let maxCellWidth = 0;
  for (const value of cellValues) {
    const valueStr = value === null || value === undefined ? '' : String(value);
    const cellWidth = estimateTextWidth(valueStr, 12);
    maxCellWidth = Math.max(maxCellWidth, cellWidth);
  }
  
  // Use the larger of header width and max cell width, with constraints
  const optimalWidth = Math.max(headerWidth, maxCellWidth);
  
  // Apply min/max constraints
  const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, optimalWidth));
  
  // If both header and cells are small, reduce width (down to 50% of default)
  if (headerWidth < defaultWidth * 0.5 && maxCellWidth < defaultWidth * 0.5) {
    return Math.max(minWidth, Math.min(constrainedWidth, defaultWidth * 0.5));
  }
  
  // If wider, allow up to 50% wider than default
  if (optimalWidth > defaultWidth) {
    return Math.min(constrainedWidth, defaultWidth * 1.5);
  }
  
  return constrainedWidth;
}

