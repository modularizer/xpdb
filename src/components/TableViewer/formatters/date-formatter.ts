import { CellFormatter, FormatterOptions } from './formatter.interface';

/**
 * Date/Time formatter
 */
export class DateFormatter implements CellFormatter {
  readonly type = 'date';
  readonly displayName = 'Date/Time';
  readonly description = 'Format dates and timestamps with customizable format';

  format(value: any, options?: FormatterOptions): string {
    if (value === null || value === undefined) return '';
    
    let date: Date;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      date = new Date(value);
    } else {
      return String(value);
    }
    
    if (isNaN(date.getTime())) {
      return String(value); // Invalid date, return original
    }
    
    const opts = this.validateOptions(options || {});
    const dateFormat = opts.dateFormat || 'M/D/Y';
    const timeFormat = opts.timeFormat || '12h';
    const showTime = opts.showTime !== false; // Default to true
    const showSeconds = opts.showSeconds || false;
    const timezone = opts.timezone || 'local';
    
    // Format date part
    let formatted = this.formatDatePart(date, dateFormat, timezone);
    
    // Format time part if needed
    if (showTime) {
      const timeStr = this.formatTimePart(date, timeFormat, showSeconds, timezone);
      formatted += ` ${timeStr}`;
    }
    
    return formatted;
  }

  private formatDatePart(date: Date, format: string, timezone: string): string {
    // Apply timezone offset if needed (simplified - for full timezone support, use a library)
    let d = date;
    if (timezone === 'utc') {
      d = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
    }
    
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    
    switch (format) {
      case 'M/D/Y':
        return `${month}/${day}/${year}`;
      case 'D/M/Y':
        return `${day}/${month}/${year}`;
      case 'Y-M-D':
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      case 'M-D-Y':
        return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`;
      case 'D M Y':
        return `${day} ${this.getMonthName(month)} ${year}`;
      case 'M D, Y':
        return `${this.getMonthName(month)} ${day}, ${year}`;
      default:
        return `${month}/${day}/${year}`;
    }
  }

  private formatTimePart(date: Date, format: string, showSeconds: boolean, timezone: string): string {
    let d = date;
    if (timezone === 'utc') {
      d = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
    }
    
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    
    if (format === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 should be 12
      const minutesStr = minutes < 10 ? `0${minutes}` : String(minutes);
      const secondsStr = seconds < 10 ? `0${seconds}` : String(seconds);
      if (showSeconds) {
        return `${hours}:${minutesStr}:${secondsStr} ${ampm}`;
      }
      return `${hours}:${minutesStr} ${ampm}`;
    } else {
      // 24h format
      const hoursStr = hours < 10 ? `0${hours}` : String(hours);
      const minutesStr = minutes < 10 ? `0${minutes}` : String(minutes);
      const secondsStr = seconds < 10 ? `0${seconds}` : String(seconds);
      if (showSeconds) {
        return `${hoursStr}:${minutesStr}:${secondsStr}`;
      }
      return `${hoursStr}:${minutesStr}`;
    }
  }

  private getMonthName(month: number): string {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[month - 1] || String(month);
  }

  canFormat(value: any): boolean {
    if (value instanceof Date) return true;
    if (typeof value === 'string') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}/;
      const dateTimeRegex = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
      if (dateRegex.test(value) || dateTimeRegex.test(value)) {
        const date = new Date(value);
        return !isNaN(date.getTime());
      }
    }
    if (typeof value === 'number') {
      const date = new Date(value);
      return !isNaN(date.getTime()) && value > 0 && value < 1e15;
    }
    return false;
  }

  getDefaultOptions(): FormatterOptions {
    return {
      dateFormat: 'M/D/Y',
      timeFormat: '12h',
      showTime: true,
      showSeconds: false,
      timezone: 'local',
    };
  }

  validateOptions(options: Partial<FormatterOptions>): FormatterOptions {
    const validDateFormats = ['M/D/Y', 'D/M/Y', 'Y-M-D', 'M-D-Y', 'D M Y', 'M D, Y'];
    const validTimeFormats = ['12h', '24h'];
    const validTimezones = ['local', 'utc'];
    
    return {
      dateFormat: validDateFormats.includes(options.dateFormat as string) 
        ? options.dateFormat 
        : 'M/D/Y',
      timeFormat: validTimeFormats.includes(options.timeFormat as string)
        ? options.timeFormat
        : '12h',
      showTime: options.showTime !== undefined ? options.showTime : true,
      showSeconds: options.showSeconds || false,
      timezone: validTimezones.includes(options.timezone as string)
        ? options.timezone
        : 'local',
    };
  }
}

