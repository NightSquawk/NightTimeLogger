'use strict';

/**
 * Guards docs/log-contract.md and docs/log-contract.schema.json against drift.
 *
 * The contract is consumed by tiers that cannot share code (Kaleidoscope in
 * Node, kaleidoscope-agent in Python, a planned Rust broker), so the only thing
 * keeping them in sync is the document. These tests make the document fail
 * loudly when the code it describes changes:
 *
 *   (a) the schema is structurally sane,
 *   (b) a real `createLogger()` line from `ntlogger/pino` conforms,
 *   (c) the level table matches `lib/levels.js` and `plugins/otel.js`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'log-contract.md');
const SCHEMA_PATH = path.join(REPO_ROOT, 'docs', 'log-contract.schema.json');

const doc = fs.readFileSync(DOC_PATH, 'utf8');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const ntlLevels = require('../lib/levels');

/**
 * Read the OTel severity maps. plugins/otel.js exports them, but it also
 * requires winston-transport at module load; fall back to parsing the source so
 * this test never depends on optional OTel plumbing being installed.
 */
function loadOtelSeverity() {
    try {
        const otel = require('../plugins/otel');
        if (otel && otel.SEVERITY_NUMBER && otel.SEVERITY_TEXT) {
            return { number: otel.SEVERITY_NUMBER, text: otel.SEVERITY_TEXT };
        }
    } catch {
        // fall through to source parsing
    }

    const src = fs.readFileSync(path.join(REPO_ROOT, 'plugins', 'otel.js'), 'utf8');
    const grab = (name, valueRe) => {
        const block = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;`).exec(src);
        if (!block) throw new Error(`could not find ${name} in plugins/otel.js`);
        const out = {};
        const rowRe = new RegExp(`(\\w+)\\s*:\\s*${valueRe}`, 'g');
        let m;
        while ((m = rowRe.exec(block[1])) !== null) out[m[1]] = m[2];
        return out;
    };
    const number = grab('SEVERITY_NUMBER', '(\\d+)');
    for (const key of Object.keys(number)) number[key] = Number(number[key]);
    const text = grab('SEVERITY_TEXT', "'([A-Z]+)'");
    return { number, text };
}

const otelSeverity = loadOtelSeverity();

/**
 * Parse the fenced level table out of the document. The HTML comment markers
 * keep this decoupled from heading text and surrounding prose.
 */
function parseLevelTable(markdown) {
    const section = /<!-- BEGIN:LEVEL-TABLE -->([\s\S]*?)<!-- END:LEVEL-TABLE -->/.exec(markdown);
    if (!section) throw new Error('LEVEL-TABLE markers not found in docs/log-contract.md');

    const rows = section[1]
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('|'))
        .map(line => line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(c => c.trim()))
        // drop the header row and the |---|---| separator
        .filter(cells => !/^-+$/.test(cells[0]) && cells[0].toLowerCase() !== 'ntl name');

    return rows.map(cells => ({
        name: cells[0],
        ntlNumber: Number(cells[1]),
        pinoNumber: Number(cells[2]),
        pythonNumber: Number(cells[3]),
        otelSeverityNumber: Number(cells[4]),
        otelSeverityText: cells[5],
        syslogSeverity: Number(cells[6]),
    }));
}

const levelTable = parseLevelTable(doc);

/**
 * Minimal hand-rolled checker for the subset of JSON Schema the contract uses.
 * Deliberately not a real validator (no new dependencies) — it covers type,
 * enum, required, anyOf-of-required, pattern, and numeric bounds, which is
 * every keyword the contract relies on for a single log line.
 */
function validate(value, sch, pointer = '$', errors = []) {
    const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

    if (sch.type) {
        const allowed = Array.isArray(sch.type) ? sch.type : [sch.type];
        const actual = typeOf(value);
        const ok = allowed.some(t => (t === 'integer' ? Number.isInteger(value) : t === actual));
        if (!ok) errors.push(`${pointer}: expected ${allowed.join('|')}, got ${actual}`);
    }
    if (sch.enum && !sch.enum.includes(value)) {
        errors.push(`${pointer}: ${JSON.stringify(value)} not in enum`);
    }
    if (sch.const !== undefined && value !== sch.const) {
        errors.push(`${pointer}: expected const ${sch.const}`);
    }
    if (typeof value === 'string' && sch.pattern && !new RegExp(sch.pattern).test(value)) {
        errors.push(`${pointer}: does not match ${sch.pattern}`);
    }
    if (typeof value === 'string' && sch.maxLength !== undefined && value.length > sch.maxLength) {
        errors.push(`${pointer}: longer than ${sch.maxLength}`);
    }
    if (typeof value === 'number') {
        if (sch.minimum !== undefined && value < sch.minimum) errors.push(`${pointer}: < ${sch.minimum}`);
        if (sch.maximum !== undefined && value > sch.maximum) errors.push(`${pointer}: > ${sch.maximum}`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of sch.required || []) {
            if (!(key in value)) errors.push(`${pointer}: missing required "${key}"`);
        }
        if (Array.isArray(sch.anyOf)) {
            const branchOk = sch.anyOf.some(branch =>
                (branch.required || []).every(key => key in value));
            if (!branchOk) errors.push(`${pointer}: satisfies no anyOf branch`);
        }
        for (const [key, sub] of Object.entries(sch.properties || {})) {
            if (!(key in value)) continue;
            const resolved = sub.$ref ? resolveRef(sub.$ref) : sub;
            validate(value[key], resolved, `${pointer}.${key}`, errors);
        }
    }
    return errors;
}

function resolveRef(ref) {
    const parts = ref.replace(/^#\//, '').split('/');
    return parts.reduce((acc, part) => acc[part], schema);
}

/**
 * Emit one real log line through `createLogger()` from `ntlogger/pino`.
 *
 * Runs in a child process with NODE_ENV=production so createLogger attaches no
 * transport and pino writes plain NDJSON to stdout — which is exactly the wire
 * format the contract specifies. Only stable fields are asserted, so this stays
 * green across changes to createLogger's option handling.
 */
function emitContractLine() {
    const script = `
        const { createLogger } = require(${JSON.stringify(path.join(REPO_ROOT, 'pino.js'))});
        const log = createLogger({ module: 'ContractTest', silent: false, level: 'info' });
        log.info({ tenantId: 't-1', correlationId: 'c-1' }, 'contract probe');
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
    });
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    return JSON.parse(lines[lines.length - 1]);
}

describe('log contract — schema structure', () => {
    test('declares draft 2020-12, an $id, and contractVersion 1', () => {
        expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
        expect(typeof schema.$id).toBe('string');
        expect(schema.$id.length).toBeGreaterThan(0);
        expect(schema.contractVersion).toBe(1);
        expect(schema.$defs.contractVersion.const).toBe(1);
        expect(schema.additionalProperties).toBe(true);
    });

    test('requires level and msg, and one of time/timestamp via anyOf', () => {
        expect(schema.required).toEqual(expect.arrayContaining(['level', 'msg']));
        expect(schema.required).not.toContain('time');
        expect(schema.required).not.toContain('timestamp');

        const branches = schema.anyOf.map(b => b.required.join(','));
        expect(branches.sort()).toEqual(['time', 'timestamp']);

        expect(schema.properties.time.type).toBe('integer');
        expect(schema.properties.timestamp.type).toBe('string');
    });

    test('level is a bounded integer enum; levelName carries the NTL names', () => {
        const level = schema.properties.level;
        expect(level.type).toBe('integer');
        expect(level.minimum).toBe(0);
        expect(typeof level.maximum).toBe('number');
        expect(level.enum).toEqual([5, 10, 20, 30, 40, 50, 60]);
        expect(level.enum.every(Number.isInteger)).toBe(true);

        expect(schema.properties.levelName.enum.sort()).toEqual(Object.keys(ntlLevels).sort());
    });

    test('every context key of section 4 is a typed property', () => {
        const contextKeys = [
            'tenantId', 'userId', 'actorName', 'sessionId', 'correlationId',
            'traceId', 'spanId', 'jobId', 'attempt', 'executor',
            'impersonatorUserId', 'agentUuid', 'commandId', 'collectionCycleId',
            'reqId', 'requestId',
        ];
        for (const key of contextKeys) {
            expect(schema.properties).toHaveProperty(key);
            const prop = schema.properties[key];
            expect(prop.type || prop.$ref).toBeDefined();
            expect(doc).toContain(`\`${key}\``);
        }
        expect(schema.properties.attempt.type).toBe('integer');
    });

    test('trace/span ids are W3C hex, and err/req/res are typed', () => {
        expect(new RegExp(schema.$defs.traceId.pattern).test('a'.repeat(32))).toBe(true);
        expect(new RegExp(schema.$defs.traceId.pattern).test('a'.repeat(31))).toBe(false);
        expect(new RegExp(schema.$defs.spanId.pattern).test('0123456789abcdef')).toBe(true);
        expect(new RegExp(schema.$defs.spanId.pattern).test('0123456789ABCDEF')).toBe(false);

        for (const key of ['type', 'name', 'message', 'stack', 'code', 'cause']) {
            expect(schema.$defs.error.properties).toHaveProperty(key);
        }
        expect(schema.$defs.error.required).toContain('message');
        expect(schema.$defs.error.properties.cause.$ref).toBe('#/$defs/error');

        expect(Object.keys(schema.properties.req.properties).sort()).toEqual(['id', 'method', 'url']);
        expect(schema.properties.res.properties.statusCode.type).toBe('integer');
        expect(schema.properties.responseTime.type).toBe('number');
    });

    test('the hand-rolled checker accepts and rejects the obvious cases', () => {
        const base = { time: 1757600000123, level: 30, msg: 'ok' };
        expect(validate(base, schema)).toEqual([]);
        expect(validate({ timestamp: '2026-09-11T18:13:20.123Z', level: 30, msg: 'ok' }, schema)).toEqual([]);

        expect(validate({ level: 30, msg: 'ok' }, schema).join()).toMatch(/anyOf/);
        expect(validate({ ...base, level: 35 }, schema).join()).toMatch(/enum/);
        expect(validate({ ...base, traceId: 'nope' }, schema).join()).toMatch(/traceId/);
        expect(validate({ ...base, err: { stack: 'x' } }, schema).join()).toMatch(/message/);
    });
});

describe('log contract — level table matches the code', () => {
    test('covers exactly the levels in lib/levels.js with the same numbers', () => {
        expect(levelTable.map(r => r.name).sort()).toEqual(Object.keys(ntlLevels).sort());
        for (const row of levelTable) {
            expect(row.ntlNumber).toBe(ntlLevels[row.name]);
        }
    });

    test('OTel severity number/text match plugins/otel.js', () => {
        for (const row of levelTable) {
            expect(row.otelSeverityNumber).toBe(otelSeverity.number[row.name]);
            expect(row.otelSeverityText).toBe(otelSeverity.text[row.name]);
        }
        expect(Object.keys(otelSeverity.number).sort()).toEqual(Object.keys(ntlLevels).sort());
    });

    test('Pino numbering is the inverse ordering of NTL numbering', () => {
        const byNtl = [...levelTable].sort((a, b) => a.ntlNumber - b.ntlNumber);
        for (let i = 1; i < byNtl.length; i++) {
            expect(byNtl[i].pinoNumber).toBeLessThan(byNtl[i - 1].pinoNumber);
        }
        expect(byNtl[0].name).toBe('fatal');
        expect(byNtl[byNtl.length - 1].name).toBe('internal');
    });

    test('documented Pino numbers are exactly the schema level enum', () => {
        expect(levelTable.map(r => r.pinoNumber).sort((a, b) => a - b))
            .toEqual([...schema.properties.level.enum].sort((a, b) => a - b));
    });

    test('syslog severities follow the OTel severity buckets', () => {
        const bucket = n => {
            if (n >= 1 && n <= 8) return 7;
            if (n >= 9 && n <= 12) return 6;
            if (n >= 13 && n <= 16) return 4;
            if (n >= 17 && n <= 20) return 3;
            if (n >= 21 && n <= 24) return 2;
            return 6;
        };
        for (const row of levelTable) {
            expect(row.syslogSeverity).toBe(bucket(row.otelSeverityNumber));
        }
    });

    test('documented Python levels match the stdlib and the agent TRACE level', () => {
        const expected = { fatal: 50, error: 40, warn: 30, info: 20, debug: 10, trace: 5, internal: 5 };
        for (const row of levelTable) {
            expect(row.pythonNumber).toBe(expected[row.name]);
        }
    });
});

describe('log contract — a real createLogger() line conforms', () => {
    let line;

    beforeAll(() => {
        line = emitContractLine();
    });

    test('emits the required core fields with the contracted types', () => {
        expect(Number.isInteger(line.time)).toBe(true);
        expect(line.time).toBeGreaterThan(1_600_000_000_000);
        expect(Number.isInteger(line.level)).toBe(true);
        expect(schema.properties.level.enum).toContain(line.level);
        expect(typeof line.msg).toBe('string');
        expect(line.msg).toBe('contract probe');
        expect(line.module).toBe('ContractTest');
        expect(Number.isInteger(line.pid)).toBe(true);
        expect(typeof line.hostname).toBe('string');
        expect(line.hostname.length).toBeGreaterThan(0);
    });

    test('omits levelName — sinks derive it from level (documented behavior)', () => {
        expect(line.levelName).toBeUndefined();
        expect(doc).toContain('Pino emitters omit `levelName`; sinks derive it from `level`');
    });

    test('carries context keys at the top level, not nested', () => {
        expect(line.tenantId).toBe('t-1');
        expect(line.correlationId).toBe('c-1');
        expect(line.context).toBeUndefined();
    });

    test('validates against the contract schema', () => {
        expect(validate(line, schema)).toEqual([]);
    });
});

describe('log contract — document covers what the transport renders', () => {
    test('every transport CONTEXT_KEY is documented and in the schema', () => {
        const { CONTEXT_KEYS } = require('../transports/pino');
        for (const key of CONTEXT_KEYS) {
            expect(doc).toContain(`\`${key}\``);
            expect(schema.properties).toHaveProperty(key);
        }
    });

    test('declares the contract version and the redaction literal', () => {
        expect(doc).toMatch(/contractVersion:\s*1/);
        expect(doc).toContain('[REDACTED]');
        expect(doc).toContain('lib/secretRedaction.js');
    });
});
