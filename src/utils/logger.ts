
export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}

class Logger {
    private level: LogLevel;

    constructor() {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase();
        if (envLevel === 'DEBUG') this.level = LogLevel.DEBUG;
        else if (envLevel === 'WARN') this.level = LogLevel.WARN;
        else if (envLevel === 'ERROR') this.level = LogLevel.ERROR;
        else this.level = LogLevel.INFO;
    }

    private formatMessage(level: string, message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    error(message: string, ...args: any[]) {
        if (this.level >= LogLevel.ERROR) {
            console.error(this.formatMessage('ERROR', message), ...args);
        }
    }

    warn(message: string, ...args: any[]) {
        if (this.level >= LogLevel.WARN) {
            console.warn(this.formatMessage('WARN', message), ...args);
        }
    }

    info(message: string, ...args: any[]) {
        if (this.level >= LogLevel.INFO) {
            console.log(this.formatMessage('INFO', message), ...args);
        }
    }

    debug(message: string, ...args: any[]) {
        if (this.level >= LogLevel.DEBUG) {
            console.log(this.formatMessage('DEBUG', message), ...args);
        }
    }
}

export const logger = new Logger();
