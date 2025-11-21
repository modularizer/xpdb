import { Platform } from 'react-native';
import { DataExporter } from './exporter.interface';
import { CsvExporter } from './csv-exporter';
import { MarkdownExporter } from './markdown-exporter';
import { JsonExporter } from './json-exporter';
import { SqliteExporter } from './sqlite-exporter';

/**
 * Registry of all available exporters
 */
class ExporterRegistry {
  private exporters: Map<string, DataExporter> = new Map();
  
  constructor() {
    // Register all built-in exporters
    this.register(new CsvExporter());
    this.register(new MarkdownExporter());
    this.register(new JsonExporter());
    
    // SQLite exporter only available on web (requires sql.js/WebAssembly)
    if (Platform.OS === 'web') {
      this.register(new SqliteExporter());
    }
  }
  
  /**
   * Register a new exporter
   */
  register(exporter: DataExporter): void {
    if (this.exporters.has(exporter.type)) {
      console.warn(`Exporter with type "${exporter.type}" already exists. Overwriting.`);
    }
    this.exporters.set(exporter.type, exporter);
  }
  
  /**
   * Get an exporter by type
   */
  get(type: string): DataExporter | undefined {
    return this.exporters.get(type);
  }
  
  /**
   * Get all registered exporters
   */
  getAll(): DataExporter[] {
    return Array.from(this.exporters.values());
  }
  
  /**
   * Get all exporter types
   */
  getTypes(): string[] {
    return Array.from(this.exporters.keys());
  }
  
  /**
   * Check if an exporter type exists
   */
  has(type: string): boolean {
    return this.exporters.has(type);
  }
}

// Export singleton instance
export const exporterRegistry = new ExporterRegistry();

