/**
 * TypeScript definitions for NightTimeLogger
 * @file index.d.ts
 */

/**
 * Log levels supported by NightTimeLogger
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'internal';

/**
 * Sampling configuration for log levels
 */
export interface SamplingConfig {
    [level: string]: number; // 0.0 to 1.0, where 1.0 = log all, 0.1 = log 10%
}

/**
 * Rate limit configuration for a log level
 */
export interface RateLimitConfig {
    max: number;    // Maximum number of logs
    window: number; // Time window in milliseconds
}

/**
 * Rate limiting configuration for log levels
 */
export interface RateLimitConfigMap {
    [level: string]: RateLimitConfig;
}

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig {
    enabled: boolean;
    threshold: number;  // Number of duplicates before squishing (default: 3)
    window: number;     // Time window in milliseconds (default: 60000)
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
    name: string;
    enabled?: boolean;
    config?: Record<string, any>;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
    /** Minimum log level to be logged */
    level?: LogLevel;
    /** Enable console logging (default: true) */
    console?: boolean;
    /** Enable file logging (default: true) */
    file?: boolean;
    /** Filename for log file (default: `${location}.log`) */
    filename?: string;
    /** Directory path where log files will be saved (default: './logs') */
    path?: string;
    /** Maximum size of log file in bytes (default: 1048576 = 1MB) */
    maxSize?: number;
    /** Maximum number of log files to retain (default: 5) */
    maxFiles?: number;
    /** Include timestamp in log messages (default: true) */
    timestamp?: boolean;
    /** Skip cache and create new logger instance (default: false) */
    skipCache?: boolean;
    /** Enable call site path reporting (default: false) */
    reportPath?: boolean;
    /** Enable debug mode for logger itself (default: false) */
    debug?: boolean;
    /** Log sampling rates per level */
    sampling?: SamplingConfig;
    /** Rate limiting configuration per level */
    rateLimit?: RateLimitConfigMap;
    /** Log deduplication configuration */
    deduplication?: DeduplicationConfig;
    /** Enable performance metrics (default: NODE_ENV === 'development') */
    performanceMetrics?: boolean;
    /** Interval in milliseconds to log statistics (default: 0 = disabled) */
    statsInterval?: number;
    /** Plugin configurations */
    plugins?: PluginConfig[];
}

/**
 * Statistics object returned by getStats()
 */
export interface LoggerStats {
    sampling: {
        total: Record<string, number>;
        sampled: Record<string, number>;
        rateLimited: Record<string, number>;
    } | null;
    deduplication: {
        totalDeduplicated: number;
        uniqueMessages: number;
        activeEntries: number;
    } | null;
    performance: {
        enabled: boolean;
        avgLogProcessingTime?: number;
        avgTransportTime?: number;
        logProcessingSamples?: number;
        transportSamples?: number;
    } | null;
}

/**
 * Logger instance interface
 */
export interface Logger {
    /**
     * Log an informational message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    info(message: string, meta?: Record<string, any>): void;
    info(message: Record<string, any>): void;

    /**
     * Log a warning message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    warn(message: string, meta?: Record<string, any>): void;
    warn(message: Record<string, any>): void;

    /**
     * Log an error message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    error(message: string, meta?: Record<string, any>): void;
    error(message: Record<string, any>): void;

    /**
     * Log a debug message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    debug(message: string, meta?: Record<string, any>): void;
    debug(message: Record<string, any>): void;

    /**
     * Log a trace message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    trace(message: string, meta?: Record<string, any>): void;
    trace(message: Record<string, any>): void;

    /**
     * Log a fatal message
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    fatal(message: string, meta?: Record<string, any>): void;
    fatal(message: Record<string, any>): void;

    /**
     * Log an internal message (logger system messages)
     * @param message - The message to log
     * @param meta - Optional metadata object
     */
    internal(message: string, meta?: Record<string, any>): void;
    internal(message: Record<string, any>): void;

    /**
     * Create a child logger with persistent context
     * @param context - Context object to merge into all logs
     * @returns Child logger instance
     */
    child(context: Record<string, any>): Logger;

    /**
     * Start a performance timer (development mode only)
     * @param label - Timer label
     */
    time?(label: string): void;

    /**
     * End a performance timer and log duration (development mode only)
     * @param label - Timer label
     * @returns Duration in milliseconds or null if timer not found
     */
    timeEnd?(label: string): number | null;

    /**
     * Get logging statistics
     * @returns Statistics object
     */
    getStats(): LoggerStats;

    /**
     * Flush all pending logs (returns Promise)
     * @returns Promise that resolves when all logs are flushed
     */
    flush(): Promise<void>;

    /**
     * Close the logger and flush all pending logs (returns Promise)
     * @returns Promise that resolves when logger is closed
     */
    close(): Promise<void>;

    /** Current log level */
    level: string;
}

/**
 * Main logger function
 * @param location - The location/name of the logger instance
 * @param config - Configuration options for the logger
 * @returns Logger instance
 */
declare function logger(location?: string, config?: LoggerConfig): Logger;

export = logger;

