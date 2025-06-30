export interface Logger {
  info(message: string, meta?: any): void;
  success(message: string, meta?: any): void;
  error(message: string, error?: any): void;
  warn(message: string, meta?: any): void;
}

class ConsoleLogger implements Logger {
  info(message: string, meta?: any) {
    console.log(`ℹ️  ${message}`, meta ? JSON.stringify(meta) : '');
  }
  
  success(message: string, meta?: any) {
    console.log(`✅ ${message}`, meta ? JSON.stringify(meta) : '');
  }
  
  error(message: string, error?: any) {
    console.error(`❌ ${message}`, error?.message || error);
  }
  
  warn(message: string, meta?: any) {
    console.warn(`⚠️  ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

export const logger: Logger = new ConsoleLogger(); 