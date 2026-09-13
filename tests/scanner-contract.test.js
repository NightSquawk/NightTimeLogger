'use strict';
const { execFileSync } = require('node:child_process');
const { createRedactor } = require('../lib/secretRedaction');
const { createTestLogger, withSecretValues } = require('../pino');
const fixtures = require('../contract/conformance.json');
const contract = require('../contract/redaction.json');

test('portable contract snapshots match JavaScript defaults', () => {
    execFileSync(process.execPath, [require.resolve('../scripts/sync-python-contract.cjs'), '--check']);
});

test.each(fixtures.redaction)('portable redaction: $input', ({ input, expected }) => {
    const redactor = createRedactor();
    expect(redactor.redact(input)).toEqual(expected);
    expect(redactor.redact(expected)).toEqual(expected);
});

test.each(fixtures.levels)('Python $python maps to Pino $pino ($name)', ({ python, pino, name }) => {
    expect(contract.pythonLevels[python]).toBe(pino);
    const { logger, records } = createTestLogger();
    logger[name]('level');
    expect(records[0].level).toBe(pino);
    return logger.close();
});

test('scoped values redact messages, JSON-escaped strings and exception text without leaking across async scopes', async () => {
    const { logger, records } = createTestLogger();
    await Promise.all(['first-secret', 'second-secret'].map(value => withSecretValues([value], async () => {
        await Promise.resolve();
        logger.error(new Error(value));
        logger.info(value === 'first-secret' ? 'second-secret' : 'first-secret');
    })));
    expect(records.filter(r => r.err).every(r => r.err.message === '[REDACTED]')).toBe(true);
    expect(records.filter(r => !r.err).map(r => r.msg)).toEqual(['second-secret', 'first-secret']);
    logger.info('first-secret');
    expect(records.at(-1).msg).toBe('first-secret');
    withSecretValues(['a"b\nc', 'REDACTED'], () => {
        const r = createRedactor();
        const text = 'a"b\nc ' + JSON.stringify('a"b\nc');
        const safe = r.redactString(text);
        expect(safe).not.toContain('a"b');
        expect(safe).not.toContain('a\\"b');
        expect(r.redactString(safe)).toBe(safe);
    });
    expect(() => withSecretValues([''], () => {})).toThrow();
    expect(() => withSecretValues(Array.from({ length: 129 }, (_, i) => String(i)), () => {})).toThrow();
    await logger.close();
});


test('scoped secrets cover final Error and Buffer interpolation before tee delivery', async () => {
    const delivered = [];
    const { logger, records } = createTestLogger({ onLog: record => delivered.push(record) });
    withSecretValues(['opaque-error', 'opaque-buffer'], () => {
        logger.info('failure %s', new Error('opaque-error'));
        logger.info('data %s', Buffer.from('opaque-buffer'));
    });
    expect(JSON.stringify(records)).not.toContain('opaque-error');
    expect(JSON.stringify(records)).not.toContain('opaque-buffer');
    expect(delivered).toEqual(records);
    await logger.close();
});
