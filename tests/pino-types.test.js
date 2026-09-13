'use strict';

/**
 * Type-declaration contract for `ntlogger/pino`.
 *
 * Consumers (TypeScript ESM, `moduleResolution: nodenext`/`bundler`) import
 * `createLogger` from `'ntlogger/pino'`, so the subpath must publish types and
 * those types must describe the real runtime surface.
 *
 * TypeScript is deliberately NOT a dependency of this package. When it cannot
 * be resolved the compile half of this suite is skipped; the packaging
 * assertions always run.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DECLARATION = path.join(ROOT, 'pino.d.ts');
const pkg = require('../package.json');

/** TypeScript and @types/node are both optional here; skip the compile when either is missing. */
function resolveOptional(id) {
    try {
        return require.resolve(id);
    } catch (_ignored) {
        return null;
    }
}

const typescriptPath = resolveOptional('typescript');
const nodeTypesPath = resolveOptional('@types/node/package.json');
// TypeScript 7's native preview build exposes a different (much smaller) JS API,
// so require createProgram explicitly rather than assuming it is there.
const canCompile = Boolean(
    typescriptPath
    && nodeTypesPath
    && typeof require(typescriptPath).createProgram === 'function',
);
const compileTest = canCompile ? test : test.skip;

/** Exercises every documented member of `ntlogger/pino`. Must produce zero diagnostics. */
const VALID_PROGRAM = `
import ntlPino, { createLogger, createPinoOptions, isSilent, installProcessHandlers, drainLogger } from './pino';
import type { CreateLoggerOptions, NtlPinoLogger, RequestTracker } from './pino';
import type { Logger as PinoLogger } from 'pino';

import Fastify, { FastifyInstance } from 'fastify';
const app: FastifyInstance = Fastify({ logger: createPinoOptions({ service: 'api' }) });
app.get('/', async (request) => { request.log.info({ deviceId: 'd1' }, 'scan'); return {}; });

const opts: CreateLoggerOptions = {
    level: 'debug',
    module: 'Api',
    defaultModule: 'Api',
    colorize: false,
    service: 'kaleidoscope',
    context: { region: 'us-east-1' },
    contextProvider: () => ({ correlationId: 'c1' }),
    contextKeys: ['correlationId'],
    redact: { extraKeys: ['ssn'], patterns: false, replacement: '***', maxDepth: 4, maxStringLength: 512 },
    sampling: { debug: 0.1, info: 0.5 },
    rateLimit: { info: { max: 100, window: 60000 }, warn: { max: 5, windowMs: 1000 } },
    deduplication: { threshold: 2, windowMs: 5000, levels: ['info', 'warn'], fatal: false },
    silent: false,
    processHandlers: {
        timeout: 2000,
        signals: ['SIGTERM'],
        exitOnSignal: false,
        signalExitCode: 0,
        uncaughtExitCode: 1,
        exitOnUnhandledRejection: true,
        unhandledRejectionLevel: 'fatal',
        onShutdown: async (reason: string) => { void reason; },
        exit: (code: number) => { void code; },
        proc: process,
        logPrefix: '[ntl]',
    },
};

const log: NtlPinoLogger = createLogger(opts);
log.info({ tenantId: 't1' }, 'hello %s', 'world');
log.error(new Error('boom'), 'failed');
log.fatal('dead');

const child: NtlPinoLogger = log.child({ jobId: 'j1' });
child.debug('from child');
const totalDeduplicated: number = child.getStats().deduplication?.totalDeduplicated ?? 0;
const sampledPerLevel: Record<string, number> = log.getStats().sampling?.sampled ?? {};
void totalDeduplicated;
void sampledPerLevel;
log.resetStats();
log.uninstallProcessHandlers?.();
void log.close(1000).then(result => result.drained);

// The decorated logger must stay usable wherever a plain pino logger is expected.
const asPino: PinoLogger = log;
void asPino.level;

// Alternate redaction shapes.
void createLogger({ redact: false });
void createLogger({ redact: ['password', 'req.headers.authorization'] });
void createLogger({ deduplication: true, processHandlers: true });
void createLogger({ destination: process.stdout });
void createLogger();

const silent: boolean = isSilent({ silent: true });
void isSilent();
void silent;

const uninstall: () => void = installProcessHandlers(log, { exitOnSignal: false });
uninstall();
void drainLogger(log, 100).then(result => result.error);
void drainLogger(log);

// Default export is the transport factory itself.
const stream: NodeJS.ReadWriteStream = ntlPino({ defaultModule: 'API', colorize: false, maxInflightRequests: 10, inflightTtlMs: 1000 });
void stream;
void ntlPino();

const line: string = ntlPino.formatLine({ time: Date.now(), level: 30, msg: 'x' }, { colorize: false });
void line;
void ntlPino.formatTimestamp(Date.now());
void ntlPino.formatTimestamp(new Date());
void ntlPino.padLevel('info');
void ntlPino.formatContext({ tenantId: 't' });

const tracker: RequestTracker = ntlPino.createRequestTracker({ maxInflightRequests: 10, inflightTtlMs: 1000 });
tracker.track('req-1', 'GET', '/health');
const taken = tracker.take('req-1');
void (taken ? taken.url : '');
tracker.prune(Date.now());
const size: number = tracker.size;
void size;
void tracker.maxInflightRequests;
void tracker.inflightTtlMs;

const contextKeys: readonly string[] = ntlPino.CONTEXT_KEYS;
void contextKeys;
`;

/** Must NOT compile: proves the declarations actually constrain callers. */
const INVALID_PROGRAM = `
import { createLogger } from './pino';
createLogger({ sampling: { info: 'very high' } });
createLogger({ noSuchOption: true });
`;

/**
 * Type-check a virtual TypeScript file rooted in the package directory, so
 * './pino' and the optional 'pino' peer resolve exactly as they do for a
 * consumer that has both installed.
 *
 * @param {string} source - TypeScript source text.
 * @returns {string[]} - Formatted diagnostic messages.
 */
function typeCheck(source) {
    const ts = require('typescript');
    const fileName = path.join(ROOT, '__ntlogger_types_probe__.ts');

    const options = {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        // Intentionally false: pino.d.ts itself must be free of errors.
        skipLibCheck: false,
        types: ['node'],
    };

    const host = ts.createCompilerHost(options, true);
    const getSourceFile = host.getSourceFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);

    host.getSourceFile = (name, languageVersion, onError, shouldCreate) => (
        name === fileName
            ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS)
            : getSourceFile(name, languageVersion, onError, shouldCreate)
    );
    host.fileExists = name => (name === fileName ? true : fileExists(name));
    host.readFile = name => (name === fileName ? source : readFile(name));

    const program = ts.createProgram([fileName], options, host);
    const diagnostics = [
        ...program.getOptionsDiagnostics(),
        ...program.getSyntacticDiagnostics(),
        ...program.getSemanticDiagnostics(),
    ];

    return diagnostics.map(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`;
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const file = path.relative(ROOT, diagnostic.file.fileName);
        return `${file}(${line + 1},${character + 1}) TS${diagnostic.code}: ${message}`;
    });
}

describe('ntlogger/pino type declarations', () => {
    describe('packaging', () => {
        test('pino.d.ts exists next to pino.js', () => {
            expect(fs.existsSync(DECLARATION)).toBe(true);
            expect(fs.readFileSync(DECLARATION, 'utf8')).toContain('export = ntlPinoTransport');
        });

        test('uses LF line endings', () => {
            expect(fs.readFileSync(DECLARATION, 'utf8')).not.toContain('\r');
        });

        test('exports map resolves types for both subpaths', () => {
            expect(pkg.exports['.']).toEqual({ types: './index.d.ts', default: './index.js' });
            expect(pkg.exports['./pino']).toEqual({ types: './pino.d.ts', default: './pino.js' });
            expect(pkg.exports['./package.json']).toBe('./package.json');
            expect(pkg.types).toBe('./index.d.ts');
        });

        test('declarations are published', () => {
            expect(pkg.files).toContain('pino.d.ts');
            expect(pkg.files).toContain('index.d.ts');
        });

        test('every documented runtime member is actually exported', () => {
            const mod = require('../pino');
            expect(typeof mod).toBe('function');
            for (const name of [
                'createLogger',
                'createPinoOptions',
                'isSilent',
                'installProcessHandlers',
                'drainLogger',
                'formatLine',
                'formatTimestamp',
                'padLevel',
                'formatContext',
                'createRequestTracker',
            ]) {
                expect(typeof mod[name]).toBe('function');
            }
            expect(Array.isArray(mod.CONTEXT_KEYS)).toBe(true);
        });
    });

    describe('compilation', () => {
        compileTest('the documented surface type-checks with zero diagnostics', () => {
            expect(typeCheck(VALID_PROGRAM)).toEqual([]);
        }, 120000);

        compileTest('invalid options are rejected', () => {
            const diagnostics = typeCheck(INVALID_PROGRAM);
            expect(diagnostics.length).toBeGreaterThanOrEqual(2);
            expect(diagnostics.join('\n')).toMatch(/sampling|noSuchOption/);
        }, 120000);
    });
});
