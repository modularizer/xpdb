import { CellFormatter } from './formatter.interface';
import { AutoFormatter } from './auto-formatter';
import { CurrencyFormatter } from './currency-formatter';
import { YearFormatter } from './year-formatter';
import { CommasFormatter } from './commas-formatter';
import { ScientificFormatter } from './scientific-formatter';
import { SuffixesFormatter } from './suffixes-formatter';
import { PlainFormatter } from './plain-formatter';
import { PercentFormatter } from './percent-formatter';
import { StarsFormatter } from './stars-formatter';
import { DateFormatter } from './date-formatter';
import { UnitsFormatter } from './units-formatter';

/**
 * Registry of all available formatters
 */
class FormatterRegistry {
  private formatters: Map<string, CellFormatter> = new Map();
  
  constructor() {
    // Register all built-in formatters
    this.register(new AutoFormatter());
    this.register(new CurrencyFormatter());
    this.register(new YearFormatter());
    this.register(new CommasFormatter());
    this.register(new ScientificFormatter());
    this.register(new SuffixesFormatter());
    this.register(new PlainFormatter());
    this.register(new PercentFormatter());
    this.register(new StarsFormatter());
    this.register(new DateFormatter());
    this.register(new UnitsFormatter());
  }
  
  /**
   * Register a new formatter
   */
  register(formatter: CellFormatter): void {
    if (this.formatters.has(formatter.type)) {
      console.warn(`Formatter with type "${formatter.type}" already exists. Overwriting.`);
    }
    this.formatters.set(formatter.type, formatter);
  }
  
  /**
   * Get a formatter by type
   */
  get(type: string): CellFormatter | undefined {
    return this.formatters.get(type);
  }
  
  /**
   * Get all registered formatters
   */
  getAll(): CellFormatter[] {
    return Array.from(this.formatters.values());
  }
  
  /**
   * Get all formatter types
   */
  getTypes(): string[] {
    return Array.from(this.formatters.keys());
  }
  
  /**
   * Check if a formatter type exists
   */
  has(type: string): boolean {
    return this.formatters.has(type);
  }
}

// Export singleton instance
export const formatterRegistry = new FormatterRegistry();

