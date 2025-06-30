class ConsoleLogger {
    info(message, meta) {
        console.log(`ℹ️  ${message}`, meta ? JSON.stringify(meta) : '');
    }
    success(message, meta) {
        console.log(`✅ ${message}`, meta ? JSON.stringify(meta) : '');
    }
    error(message, error) {
        console.error(`❌ ${message}`, error?.message || error);
    }
    warn(message, meta) {
        console.warn(`⚠️  ${message}`, meta ? JSON.stringify(meta) : '');
    }
}
export const logger = new ConsoleLogger();
