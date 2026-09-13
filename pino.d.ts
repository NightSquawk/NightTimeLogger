/**
 * TypeScript definitions for `ntlogger/pino`
 * @file pino.d.ts
 *
 * The runtime module is CommonJS and its default export is the Pino transport
 * factory itself (so `transport: { target: 'ntlogger/pino' }` keeps working),
 * decorated with the `createLogger()` / process-handler helpers and the
 * formatter internals. That shape maps onto `export =` plus a namespace merge.
 *
 * `pino` is an *optional* peer dependency of ntlogger. Only the type-level
 * imports below depend on it, and every consumer that calls `createLogger()`
 * necessarily has pino installed.
 */

import type {
    Bindings,
    ChildLoggerOptions,
    DestinationStream,
    Logger as PinoLogger,
    LoggerOptions,
} from 'pino';

/**
 * Pino transport factory. Returns the split2 stream Pino's worker writes into.
 *
 * @param opts - Transport options.
 */
declare function ntlPinoTransport(opts?: ntlPinoTransport.PinoTransportOptions): NodeJS.ReadWriteStream;

declare namespace ntlPinoTransport {
    /**
     * NightTimeLogger log levels, lowest to highest priority.
     * `internal` has no Pino numeric equivalent and is resolved by name.
     */
    export type NtlLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'internal';

    /** Options accepted by the transport factory (`transports/pino.js`). */
    export interface PinoTransportOptions {
        /** Label used when a log object carries no `module` / `location` / `name`. */
        defaultModule?: string;
        /** Set to `false` to strip every ANSI escape from the rendered line. */
        colorize?: boolean;
        /** Cap on remembered in-flight HTTP requests (default: 1000). */
        maxInflightRequests?: number;
        /** Max age of a remembered in-flight HTTP request in ms (default: 60000). */
        inflightTtlMs?: number;
    }

    /** A request-start line remembered by the in-flight request tracker. */
    export interface TrackedRequest {
        method: string;
        url: string;
    }

    /**
     * Bounded, lazily-pruned map of in-flight HTTP requests, used to pair
     * pino-http/Fastify request-start lines with their completion lines.
     */
    export interface RequestTracker {
        /** Remember an in-flight request. Re-tracking an id refreshes its position. */
        track(id: string, method: string, url: string, now?: number): void;
        /** Look up and forget a tracked request. */
        take(id: string): TrackedRequest | null;
        /** Drop expired entries and enforce the size cap. */
        prune(now?: number): void;
        /** Number of currently tracked requests. */
        readonly size: number;
        /** Resolved cap on tracked requests. */
        readonly maxInflightRequests: number;
        /** Resolved entry TTL in milliseconds. */
        readonly inflightTtlMs: number;
    }

    /** Options for the secret redactor (`lib/secretRedaction.js`). */
    export interface RedactionOptions {
        /** Replace the default key list, or `false` to disable key matching. */
        keys?: string[] | false;
        /** Additional key names to redact, on top of `keys`. */
        extraKeys?: string[];
        /** Replace the default secret-shape patterns, or `false` to disable them. */
        patterns?: RegExp[] | false;
        /** Additional secret-shape patterns, on top of `patterns`. */
        extraPatterns?: RegExp[];
        /** Token substituted for redacted values (default: `'[REDACTED]'`). */
        replacement?: string;
        /** Depth beyond which containers collapse to `'[Object]'` (default: 8). */
        maxDepth?: number;
        /** Length beyond which strings are clipped (default: 16384). */
        maxStringLength?: number;
    }

    /** Per-level rate limit. `window` and `windowMs` are aliases (default: 60000). */
    export interface RateLimitRule {
        max: number;
        window?: number;
        windowMs?: number;
    }

    /** Duplicate-message collapsing configuration. */
    export interface DeduplicationOptions {
        /** Set to `false` to disable. Any other object shape enables it. */
        enabled?: boolean;
        /** Occurrences before duplicates are collapsed (default: 3). */
        threshold?: number;
        /** Window in ms. `window` and `windowMs` are aliases (default: 60000). */
        window?: number;
        windowMs?: number;
        /** Restrict deduplication to these levels. */
        levels?: NtlLevel[];
        /** Opt `fatal` in; it is never deduplicated otherwise. */
        fatal?: boolean;
    }

    /** Sampling/rate-limit counters, keyed by level name. */
    export interface SamplingStats {
        total: Record<string, number>;
        sampled: Record<string, number>;
        rateLimited: Record<string, number>;
    }

    /** Deduplication counters. */
    export interface DeduplicationStats {
        totalDeduplicated: number;
        uniqueMessages: number;
        activeEntries: number;
    }

    /** Snapshot returned by `logger.getStats()`. Members are `null` when unconfigured. */
    export interface NtlPinoStats {
        levels: Record<NtlLevel, number>;
        hookErrors: number;
        onLog: { pending: number; dropped: number; limit: number };
        sampling: SamplingStats | null;
        deduplication: DeduplicationStats | null;
    }

    /** Result of a bounded logger drain. Never rejects. */
    export interface DrainResult {
        drained: boolean;
        error?: Error | string;
    }

    /**
     * Minimal `process` surface used by `installProcessHandlers`. The real
     * `NodeJS.Process` satisfies it; tests can pass a stub.
     */
    export interface ProcessLike {
        on(event: string, listener: (...args: any[]) => void): unknown;
        off?(event: string, listener: (...args: any[]) => void): unknown;
        removeListener?(event: string, listener: (...args: any[]) => void): unknown;
        exit?(code?: number): unknown;
    }

    /** Options for `installProcessHandlers()` (`lib/processHandlers.js`). */
    export interface InstallProcessHandlersOptions {
        /** Total shutdown budget in ms, covering the hook and the drain (default: 4000). */
        timeout?: number;
        /** Signals to trap (default: `['SIGTERM', 'SIGINT']`). */
        signals?: string[];
        /** Exit the process after a trapped signal (default: `true`). */
        exitOnSignal?: boolean;
        /** Exit code used for a trapped signal (default: 0). */
        signalExitCode?: number;
        /** Exit code used for `uncaughtException` (default: 1). */
        uncaughtExitCode?: number;
        /** Exit after an unhandled rejection (default: `false`). */
        exitOnUnhandledRejection?: boolean;
        /** Level used to log an unhandled rejection (default: `'error'`). */
        unhandledRejectionLevel?: NtlLevel | (string & {});
        /** User shutdown hook, run before the drain and bounded by `timeout`. */
        onShutdown?: (reason: string) => void | Promise<void>;
        /** Override `process.exit` (primarily for tests). */
        exit?: (code: number) => void;
        /** Override the process object (primarily for tests). */
        proc?: ProcessLike;
        /** Prefix prepended to every message this module logs. */
        logPrefix?: string;
    }

    /** Options for `createLogger()`. */
    export interface CreateLoggerOptions {
        /** Receives a detached redacted record; async work is drained by close(). */
        /** Maximum in-flight callback promises; overflow drops newest callback, not the primary log. */
        onLogMaxPending?: number;
        onLog?: (record: Record<string, any>) => void | Promise<void>;
        /** Use the application's OTel provider; never registers or shuts down a provider. */
        otel?: boolean | { loggerProvider?: { getLogger(name: string): { emit(record: any): void }; forceFlush?(): Promise<void> }; name?: string };
        /** Pino level. Defaults to `LOG_LEVEL`, else `debug` in dev / `info` in production. */
        level?: string;
        /** Module label added to every line and used as the transport's default label. */
        module?: string;
        /** Transport label fallback when `module` is not set. */
        defaultModule?: string;
        /** Forwarded to the NTL transport. */
        colorize?: boolean;
        /** Constant top-level `service` field (log-contract core field). */
        service?: string;
        /** Static top-level fields merged into every line. */
        context?: Record<string, unknown>;
        /** Called per log call; its object result is merged at top level. */
        contextProvider?: () => Record<string, unknown> | null | undefined;
        /** When set, only these keys are taken from the provider result. */
        contextKeys?: string[];
        /** Secret redaction. Defaults to on; `false` disables it entirely. */
        redact?: false | string[] | RedactionOptions;
        /** Per-level sampling rates, 0.0 - 1.0. */
        sampling?: Partial<Record<NtlLevel, number>>;
        /** Per-level rate limits. */
        rateLimit?: Partial<Record<NtlLevel, RateLimitRule>>;
        /** Duplicate-message collapsing. `true` enables the defaults. */
        deduplication?: boolean | DeduplicationOptions;
        /** Force silent mode on/off; see `isSilent()`. */
        silent?: boolean;
        /** Opt in to crash/signal handlers. `true` uses the defaults. */
        processHandlers?: boolean | InstallProcessHandlersOptions;
        /** Advanced/tests: a Pino destination. Replaces the NTL transport. */
        destination?: DestinationStream | NodeJS.WritableStream;
    }

    /**
     * A real Pino logger plus ntlogger's additive API.
     *
     * `getStats` / `resetStats` / `close` / `child` are non-enumerable own
     * properties, so children inherit them through the prototype chain.
     */
    export interface NtlPinoExtras {
        /** Emitted level counts, callback/export hook errors, sampling and deduplication. */
        getStats(): NtlPinoStats;
        /** Zero all counters shared by the root and its children. */
        resetStats(): void;
        /**
         * Release sampler/deduplicator timers, then drain the destination.
         * Closing a child leaves its parent open. Calls after close throw, even at disabled levels.
         */
        close(timeout?: number): Promise<DrainResult>;
        /** Present only when `processHandlers` was enabled. */
        uninstallProcessHandlers?: () => void;
        /** Child logger with redacted bindings; keeps the ntlogger additions. */
        child(bindings: Bindings, options?: ChildLoggerOptions): NtlPinoLogger;
    }

    /**
     * The extras are listed first so `child()` resolves to the ntlogger-aware
     * overload; the intersection keeps the value assignable to `pino.Logger`
     * (Fastify's `loggerInstance`, `pino-http`, ...).
     */
    export type NtlPinoLogger = NtlPinoExtras & PinoLogger;

    /** Create a pre-configured Pino logger that follows NightTimeLogger conventions. */
    export function withSecretValues<T>(values: string[], callback: () => T): T;

    export function createLogger(opts?: CreateLoggerOptions): NtlPinoLogger;

    /** Framework-owned JSON logger options; no ntlogger lifecycle or timers. */
    export type CreatePinoOptions = Pick<CreateLoggerOptions,
        'level' | 'module' | 'service' | 'context' | 'contextProvider' | 'contextKeys' | 'redact' | 'silent' | 'onLog' | 'onLogMaxPending' | 'otel'
    > & { serializers?: LoggerOptions['serializers'] };
    export function createPinoOptions(opts?: CreatePinoOptions): LoggerOptions;

    /** Synchronous capture of serialized, redacted records; explicitly silent loggers capture nothing. */
    export function createTestLogger(opts?: Omit<CreateLoggerOptions, 'destination' | 'processHandlers'>): {
        logger: NtlPinoLogger;
        records: Array<Record<string, any>>;
    };

    /**
     * Resolve silent mode: `opts.silent` -> `NTLOGGER_SILENT` -> `NODE_ENV === 'test'` or nonempty `NODE_TEST_CONTEXT`.
     */
    export function isSilent(opts?: { silent?: boolean }): boolean;

    /**
     * Install uncaughtException / unhandledRejection / signal handlers.
     * Installing twice for the same logger returns the first uninstall function.
     *
     * @returns Idempotent uninstall function.
     */
    export function installProcessHandlers(
        logger: object,
        options?: InstallProcessHandlersOptions,
    ): () => void;

    /** Flush whatever the logger supports, bounded by `timeout` ms (default: 5000). Never rejects. */
    export function drainLogger(logger: object, timeout?: number): Promise<DrainResult>;

    /** Format a single Pino log object into an NTL-style line. */
    export function formatLine(
        obj: Record<string, any>,
        opts?: PinoTransportOptions,
        tracker?: RequestTracker | null,
    ): string;

    /** Format a timestamp as `YYYY-MM-DD HH:mm:ss`. */
    export function formatTimestamp(epoch: number | string | Date): string;

    /** Pad a level name to 8 characters. */
    export function padLevel(name: string): string;

    /** Render the `{k=v ...}` structured-context suffix, or `''`. */
    export function formatContext(obj: Record<string, any>): string;

    /** Create a bounded in-flight HTTP request tracker. */
    export function createRequestTracker(opts?: {
        maxInflightRequests?: number;
        inflightTtlMs?: number;
    }): RequestTracker;

    /** Context field names rendered by `formatContext()`, in render order. */
    export const CONTEXT_KEYS: readonly string[];
}

export = ntlPinoTransport;
