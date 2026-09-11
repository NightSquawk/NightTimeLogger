/**
 * @file /tests/secretRedaction.test.js
 * @description Tests for the reusable secret redaction module.
 */

'use strict';

const {
    createRedactor,
    DEFAULT_KEYS,
    DEFAULT_PATTERNS,
    REDACTED,
} = require('../lib/secretRedaction');

describe('secretRedaction: module surface', () => {
    test('exports the documented API', () => {
        expect(typeof createRedactor).toBe('function');
        expect(Array.isArray(DEFAULT_KEYS)).toBe(true);
        expect(Array.isArray(DEFAULT_PATTERNS)).toBe(true);
        expect(REDACTED).toBe('[REDACTED]');
    });

    test('a redactor exposes redactString, redactObject, redact and isSensitiveKey', () => {
        const r = createRedactor();
        expect(typeof r.redactString).toBe('function');
        expect(typeof r.redactObject).toBe('function');
        expect(typeof r.redact).toBe('function');
        expect(typeof r.isSensitiveKey).toBe('function');
    });

    test('createRedactor works with no arguments', () => {
        expect(() => createRedactor()).not.toThrow();
        expect(createRedactor().redactString('password=hunter2')).toBe('password=[REDACTED]');
    });

    test('DEFAULT_KEYS contains credential names but not generic context identifiers', () => {
        for (const key of ['password', 'token', 'authorization', 'cookie', 'webhookurl', 'snmpcommunity']) {
            expect(DEFAULT_KEYS).toContain(key);
        }
        for (const key of ['sessionid', 'sessionId', 'userId', 'tenantId', 'correlationId', 'traceId', 'requestId']) {
            expect(DEFAULT_KEYS).not.toContain(key);
        }
    });

    test('DEFAULT_PATTERNS are all global regexes', () => {
        for (const pattern of DEFAULT_PATTERNS) {
            expect(pattern).toBeInstanceOf(RegExp);
            expect(pattern.global).toBe(true);
        }
    });
});

describe('secretRedaction: key matching', () => {
    const r = createRedactor();

    test('matches exactly', () => {
        expect(r.isSensitiveKey('password')).toBe(true);
        expect(r.isSensitiveKey('username')).toBe(false);
    });

    test('is case-insensitive', () => {
        expect(r.isSensitiveKey('PASSWORD')).toBe(true);
        expect(r.isSensitiveKey('Authorization')).toBe(true);
        expect(r.isSensitiveKey('ApiKey')).toBe(true);
    });

    test('is separator-insensitive across - and _', () => {
        expect(r.isSensitiveKey('api_key')).toBe(true);
        expect(r.isSensitiveKey('api-key')).toBe(true);
        expect(r.isSensitiveKey('X-API-Key')).toBe(true);
        expect(r.isSensitiveKey('apikey')).toBe(true);
        expect(r.isSensitiveKey('access_token')).toBe(true);
        expect(r.isSensitiveKey('Proxy-Authorization')).toBe(true);
        expect(r.isSensitiveKey('x-device-installation-secret')).toBe(true);
        expect(r.isSensitiveKey('community_string')).toBe(true);
    });

    test('does not match generic context identifiers', () => {
        for (const key of ['sessionId', 'userId', 'tenantId', 'correlationId', 'traceId', 'requestId']) {
            expect(r.isSensitiveKey(key)).toBe(false);
        }
    });

    test('handles non-string and empty keys without throwing', () => {
        expect(r.isSensitiveKey(undefined)).toBe(false);
        expect(r.isSensitiveKey(null)).toBe(false);
        expect(r.isSensitiveKey(42)).toBe(false);
        expect(r.isSensitiveKey('')).toBe(false);
    });

    test('replaces matched values regardless of value type', () => {
        const out = r.redactObject({
            password: 'hunter2',
            token: 12345,
            credentials: { user: 'a', pass: 'b' },
            cookie: ['a', 'b'],
            secret: true,
        });
        expect(out.password).toBe(REDACTED);
        expect(out.token).toBe(REDACTED);
        expect(out.credentials).toBe(REDACTED);
        expect(out.cookie).toBe(REDACTED);
        expect(out.secret).toBe(REDACTED);
    });

    test('keeps null and undefined values as-is', () => {
        const out = r.redactObject({ password: null, token: undefined });
        expect(out.password).toBeNull();
        expect(out).toHaveProperty('token');
        expect(out.token).toBeUndefined();
    });

    test('matches on key name only, at any nesting level', () => {
        const out = r.redactObject({ db: { conn: { auth: { password: 'p' } } } });
        expect(out.db.conn.auth.password).toBe(REDACTED);
    });
});

describe('secretRedaction: default patterns (positive and negative)', () => {
    const r = createRedactor();

    test('kv-secret: key=value / key: "value"', () => {
        expect(r.redactString('api_key=abcd1234')).toBe('api_key=[REDACTED]');
        expect(r.redactString('client_secret: "s3cr3tvalue"')).toContain(REDACTED);
        expect(r.redactString('client_secret: "s3cr3tvalue"')).not.toContain('s3cr3tvalue');
        // negative: ordinary field
        expect(r.redactString('username=alice')).toBe('username=alice');
    });

    test('generic key=value keeps the key and redacts short values kv-secret skips', () => {
        expect(r.redactString('token: ab')).toBe('token: [REDACTED]');
        expect(r.redactString('password=xy')).toBe('password=[REDACTED]');
        // negative: no separator, just prose
        expect(r.redactString('the token was rotated yesterday')).toBe('the token was rotated yesterday');
    });

    test('AWS access key id', () => {
        expect(r.redactString('key AKIAIOSFODNN7EXAMPLE used')).toBe('key [REDACTED] used');
        expect(r.redactString('AKIASHORT')).toBe('AKIASHORT');
    });

    test('Bearer tokens', () => {
        expect(r.redactString('Authorization: Bearer abcdefghijklmnopqrstuv'))
            .toBe('Authorization: Bearer [REDACTED]');
        expect(r.redactString('Bearer me')).toBe('Bearer me');
    });

    test('Basic auth headers', () => {
        expect(r.redactString('Authorization: Basic YWRtaW46c3VwZXJzZWNyZXQx'))
            .toBe('Authorization: Basic [REDACTED]');
        // negative: prose must survive
        expect(r.redactString('Basic authentication is required')).toBe('Basic authentication is required');
    });

    test('JWT', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P';
        expect(r.redactString('token issued ' + jwt)).toBe('token issued [REDACTED]');
        expect(r.redactString('eyJust a note here')).toBe('eyJust a note here');
    });

    test('PEM private key blocks', () => {
        const pem = 'before -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY----- after';
        expect(r.redactString(pem)).toBe('before [REDACTED] after');
        expect(r.redactString('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'))
            .toContain('BEGIN CERTIFICATE');
    });

    test('GitHub tokens', () => {
        expect(r.redactString('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(REDACTED);
        expect(r.redactString('gho_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(REDACTED);
        expect(r.redactString('ghu_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(REDACTED);
        expect(r.redactString('ghs_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(REDACTED);
        expect(r.redactString('ghr_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(REDACTED);
        expect(r.redactString('github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz')).toBe(REDACTED);
        expect(r.redactString('ghost writer at github')).toBe('ghost writer at github');
    });

    test('Slack tokens', () => {
        // Assembled at runtime so the literal never matches GitHub push protection.
        const slack = (kind) => ['xox' + kind, '1234567890', 'abcdefghijklmno'].join('-');
        expect(r.redactString(slack('b'))).toBe(REDACTED);
        expect(r.redactString(slack('p'))).toBe(REDACTED);
        expect(r.redactString('xoxo boxes everywhere')).toBe('xoxo boxes everywhere');
    });

    test('Stripe keys', () => {
        expect(r.redactString('sk_live_abcdefghij1234567890')).toBe(REDACTED);
        expect(r.redactString('sk_test_abcdefghij1234567890')).toBe(REDACTED);
        expect(r.redactString('rk_live_abcdefghij1234567890')).toBe(REDACTED);
        expect(r.redactString('whsec_abcdefghij1234567890')).toBe(REDACTED);
        expect(r.redactString('sk_ is not a key')).toBe('sk_ is not a key');
    });

    test('Discord webhook URLs redact only the token segment', () => {
        expect(r.redactString('https://discord.com/api/webhooks/123456789/AbCdEf_tokEN-123'))
            .toBe('https://discord.com/api/webhooks/123456789/[REDACTED]');
        expect(r.redactString('https://discordapp.com/api/v10/webhooks/987/SeCrEtToKeN'))
            .toBe('https://discordapp.com/api/v10/webhooks/987/[REDACTED]');
        expect(r.redactString('https://discord.com/api/guilds/1234'))
            .toBe('https://discord.com/api/guilds/1234');
    });

    test('URL-embedded credentials redact only the password', () => {
        expect(r.redactString('postgres://admin:s3cr3t@db.internal:5432/app'))
            .toBe('postgres://admin:[REDACTED]@db.internal:5432/app');
        expect(r.redactString('redis://:onlypass@cache:6379'))
            .toBe('redis://:[REDACTED]@cache:6379');
        expect(r.redactString('https://example.com/path?x=1'))
            .toBe('https://example.com/path?x=1');
    });

    test('patterns apply to every occurrence in a string', () => {
        const out = r.redactString('AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLF');
        expect(out).toBe('[REDACTED] and [REDACTED]');
    });

    test('repeated calls are stable (regex lastIndex never leaks)', () => {
        const input = 'Bearer abcdefghijklmnopqrstuv';
        for (let i = 0; i < 5; i++) {
            expect(r.redactString(input)).toBe('Bearer [REDACTED]');
        }
        // Shared DEFAULT_PATTERNS objects are never advanced by the redactor.
        for (const pattern of DEFAULT_PATTERNS) {
            expect(pattern.lastIndex).toBe(0);
        }
    });

    test('two redactors do not share regex state', () => {
        const a = createRedactor();
        const b = createRedactor();
        expect(a.redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
        expect(b.redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
        expect(a.redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
    });

    test('patterns apply inside string values of objects', () => {
        const out = r.redactObject({ msg: 'called with Bearer abcdefghijklmnopqrstuv' });
        expect(out.msg).toBe('called with Bearer [REDACTED]');
    });
});

describe('secretRedaction: redactObject structures', () => {
    const r = createRedactor();

    test('never mutates the input', () => {
        const input = { password: 'hunter2', nested: { token: 'abc' } };
        const snapshot = JSON.parse(JSON.stringify(input));
        r.redactObject(input);
        expect(input).toEqual(snapshot);
    });

    test('nested array of objects', () => {
        const input = {
            users: [
                { name: 'a', password: 'p1' },
                { name: 'b', credentials: { apiKey: 'k' } },
            ],
        };
        const out = r.redactObject(input);
        expect(out.users[0]).toEqual({ name: 'a', password: REDACTED });
        expect(out.users[1]).toEqual({ name: 'b', credentials: REDACTED });
        expect(Array.isArray(out.users)).toBe(true);
    });

    test('deeply nested arrays of arrays', () => {
        const out = r.redactObject([[{ token: 't' }], [[{ ok: 'yes' }]]]);
        expect(out[0][0].token).toBe(REDACTED);
        expect(out[1][0][0].ok).toBe('yes');
    });

    test('circular references become [Circular]', () => {
        const input = { name: 'root' };
        input.self = input;
        input.child = { parent: input, password: 'p' };
        const out = r.redactObject(input);
        expect(out.self).toBe('[Circular]');
        expect(out.child.parent).toBe('[Circular]');
        expect(out.child.password).toBe(REDACTED);
        expect(() => JSON.stringify(out)).not.toThrow();
    });

    test('circular arrays become [Circular]', () => {
        const arr = [1];
        arr.push(arr);
        const out = r.redactObject(arr);
        expect(out[0]).toBe(1);
        expect(out[1]).toBe('[Circular]');
    });

    test('a repeated (non-circular) sibling is not treated as circular', () => {
        const shared = { a: 1 };
        const out = r.redactObject({ x: shared, y: shared });
        expect(out.x).toEqual({ a: 1 });
        expect(out.y).toEqual({ a: 1 });
    });

    test('Error with a Bearer token in its message keeps name/stack and redacts the token', () => {
        const err = new Error('request failed: Bearer abcdefghijklmnopqrstuv');
        err.code = 'EAUTH';
        const out = r.redactObject(err);
        expect(out.name).toBe('Error');
        expect(out.message).toBe('request failed: Bearer [REDACTED]');
        expect(typeof out.stack).toBe('string');
        expect(out.stack.length).toBeGreaterThan(0);
        expect(out.stack).not.toContain('abcdefghijklmnopqrstuv');
        expect(out.code).toBe('EAUTH');
        // Result is a plain object, safe to serialize.
        expect(JSON.parse(JSON.stringify(out)).message).toBe('request failed: Bearer [REDACTED]');
    });

    test('Error custom string properties are pattern-redacted and sensitive keys replaced', () => {
        const err = new TypeError('bad input');
        err.url = 'postgres://admin:s3cr3t@db:5432/app';
        err.authorization = 'Bearer abcdefghijklmnopqrstuv';
        const out = r.redactObject(err);
        expect(out.name).toBe('TypeError');
        expect(out.url).toBe('postgres://admin:[REDACTED]@db:5432/app');
        expect(out.authorization).toBe(REDACTED);
    });

    test('Error cause chains are preserved and redacted', () => {
        const inner = new Error('inner: api_key=abcd1234');
        const outer = new Error('outer', { cause: inner });
        const out = r.redactObject(outer);
        expect(out.cause.name).toBe('Error');
        expect(out.cause.message).toBe('inner: api_key=[REDACTED]');
    });

    test('Errors nested inside objects and arrays are handled', () => {
        const out = r.redactObject({ errors: [new Error('boom')] });
        expect(out.errors[0].message).toBe('boom');
        expect(typeof out.errors[0].stack).toBe('string');
    });

    test('Date is stringified sensibly', () => {
        const date = new Date('2024-01-02T03:04:05.000Z');
        const out = r.redactObject({ at: date });
        expect(out.at).toBe('2024-01-02T03:04:05.000Z');
    });

    test('invalid Date does not throw', () => {
        const out = r.redactObject({ at: new Date('nope') });
        expect(out.at).toBe('Invalid Date');
    });

    test('Buffer contents are never emitted', () => {
        const out = r.redactObject({ payload: Buffer.from('supersecretbytes') });
        expect(out.payload).toBe('[Buffer 16 bytes]');
        expect(out.payload).not.toContain('supersecret');
    });

    test('TypedArray and ArrayBuffer are summarized', () => {
        const out = r.redactObject({ ta: new Uint8Array(4), ab: new ArrayBuffer(8) });
        expect(out.ta).toBe('[Uint8Array 4 bytes]');
        expect(out.ab).toBe('[ArrayBuffer 8 bytes]');
    });

    test('RegExp is stringified', () => {
        const out = r.redactObject({ re: /abc/gi });
        expect(out.re).toBe('/abc/gi');
    });

    test('functions and symbols are stringified, never invoked', () => {
        const spy = jest.fn();
        const out = r.redactObject({ fn: function namedFn() { spy(); }, anon: () => {}, sym: Symbol('s') });
        expect(out.fn).toBe('[Function: namedFn]');
        expect(typeof out.anon).toBe('string');
        expect(out.sym).toBe('Symbol(s)');
        expect(spy).not.toHaveBeenCalled();
    });

    test('Map converts to object form with key matching applied', () => {
        const map = new Map([['user', 'bob'], ['password', 'hunter2'], [7, 'seven']]);
        const out = r.redactObject({ map });
        expect(out.map.user).toBe('bob');
        expect(out.map.password).toBe(REDACTED);
        expect(out.map['7']).toBe('seven');
    });

    test('Set converts to an array with values redacted', () => {
        const set = new Set(['ok', 'Bearer abcdefghijklmnopqrstuv']);
        const out = r.redactObject({ set });
        expect(Array.isArray(out.set)).toBe(true);
        expect(out.set).toEqual(['ok', 'Bearer [REDACTED]']);
    });

    test('null, undefined and primitives pass through unchanged', () => {
        expect(r.redactObject(null)).toBeNull();
        expect(r.redactObject(undefined)).toBeUndefined();
        expect(r.redactObject(42)).toBe(42);
        expect(r.redactObject(true)).toBe(true);
        expect(r.redactObject(10n)).toBe(10n);
        const out = r.redactObject({ a: null, b: undefined, c: 0, d: false, e: NaN });
        expect(out).toEqual({ a: null, b: undefined, c: 0, d: false, e: NaN });
    });

    test('a getter that throws yields [Unreadable] instead of propagating', () => {
        const input = {
            ok: 'fine',
            get boom() {
                throw new Error('getter exploded');
            },
        };
        let out;
        expect(() => {
            out = r.redactObject(input);
        }).not.toThrow();
        expect(out.ok).toBe('fine');
        expect(out.boom).toBe('[Unreadable]');
    });

    test('class instances are walked as plain objects', () => {
        class Conn {
            constructor() {
                this.host = 'db';
                this.password = 'hunter2';
            }
        }
        const out = r.redactObject(new Conn());
        expect(out).toEqual({ host: 'db', password: REDACTED });
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });

    test('null-prototype objects are walked', () => {
        const bag = Object.create(null);
        bag.password = 'p';
        bag.keep = 'v';
        const out = r.redactObject(bag);
        expect(out.password).toBe(REDACTED);
        expect(out.keep).toBe('v');
    });

    test('redact() dispatches on type', () => {
        expect(r.redact('api_key=abcd1234')).toBe('api_key=[REDACTED]');
        expect(r.redact({ password: 'p' })).toEqual({ password: REDACTED });
        expect(r.redact(5)).toBe(5);
        expect(r.redact(null)).toBeNull();
    });

    test('redactString ignores non-strings', () => {
        expect(r.redactString(5)).toBe(5);
        expect(r.redactString(null)).toBeNull();
        expect(r.redactString(undefined)).toBeUndefined();
        expect(r.redactString('')).toBe('');
    });
});

describe('secretRedaction: configuration', () => {
    test('patterns: false disables pattern scanning but keeps key matching', () => {
        const r = createRedactor({ patterns: false });
        expect(r.redactString('Bearer abcdefghijklmnopqrstuv')).toBe('Bearer abcdefghijklmnopqrstuv');
        expect(r.redactObject({ password: 'p', msg: 'api_key=abcd1234' }))
            .toEqual({ password: REDACTED, msg: 'api_key=abcd1234' });
    });

    test('keys: false disables key matching but keeps patterns', () => {
        const r = createRedactor({ keys: false });
        expect(r.isSensitiveKey('password')).toBe(false);
        const out = r.redactObject({ password: 'plainvalue', msg: 'Bearer abcdefghijklmnopqrstuv' });
        expect(out.password).toBe('plainvalue');
        expect(out.msg).toBe('Bearer [REDACTED]');
    });

    test('keys: false and patterns: false is a pure deep copy', () => {
        const r = createRedactor({ keys: false, patterns: false });
        const input = { password: 'p', nested: { token: 'Bearer abcdefghijklmnopqrstuv' } };
        const out = r.redactObject(input);
        expect(out).toEqual(input);
        expect(out).not.toBe(input);
        expect(out.nested).not.toBe(input.nested);
    });

    test('custom keys replace the defaults', () => {
        const r = createRedactor({ keys: ['customfield'] });
        expect(r.isSensitiveKey('customField')).toBe(true);
        expect(r.isSensitiveKey('password')).toBe(false);
    });

    test('extraKeys are appended to the defaults', () => {
        const r = createRedactor({ extraKeys: ['x-tenant-secret-header', 'pin_code'] });
        expect(r.isSensitiveKey('password')).toBe(true);
        expect(r.isSensitiveKey('X_TENANT_SECRET_HEADER')).toBe(true);
        // Normalization strips `-`/`_`, so pin_code, pin-code and pinCode unify.
        expect(r.isSensitiveKey('pinCode')).toBe(true);
        expect(r.isSensitiveKey('pin-code')).toBe(true);
        expect(r.isSensitiveKey('pincodes')).toBe(false);
        expect(r.redactObject({ pin_code: '1234' }).pin_code).toBe(REDACTED);
    });

    test('extraPatterns are appended to the defaults', () => {
        const r = createRedactor({ extraPatterns: [/\bINTERNAL-[0-9]{6}\b/g] });
        expect(r.redactString('ref INTERNAL-123456 here')).toBe('ref [REDACTED] here');
        // defaults still apply
        expect(r.redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
    });

    test('extraPatterns work alongside patterns: false', () => {
        const r = createRedactor({ patterns: false, extraPatterns: [/\bONLY-ME\b/g] });
        expect(r.redactString('AKIAIOSFODNN7EXAMPLE ONLY-ME')).toBe('AKIAIOSFODNN7EXAMPLE [REDACTED]');
    });

    test('a non-global extraPattern is upgraded to global and its lastIndex is never touched', () => {
        const supplied = /secretword/i;
        const r = createRedactor({ extraPatterns: [supplied] });
        expect(r.redactString('secretword and secretword')).toBe('[REDACTED] and [REDACTED]');
        expect(supplied.lastIndex).toBe(0);
        expect(supplied.global).toBe(false);
    });

    test('custom patterns replace the defaults', () => {
        const r = createRedactor({ patterns: [/\bmine\b/g] });
        expect(r.redactString('mine and Bearer abcdefghijklmnopqrstuv'))
            .toBe('[REDACTED] and Bearer abcdefghijklmnopqrstuv');
    });

    test('custom replacement token is used everywhere', () => {
        const r = createRedactor({ replacement: '***' });
        expect(r.redactString('AKIAIOSFODNN7EXAMPLE')).toBe('***');
        expect(r.redactObject({ password: 'p' }).password).toBe('***');
        expect(r.redactString('Bearer abcdefghijklmnopqrstuv')).toBe('Bearer ***');
    });

    test('maxDepth replaces deeper containers with [Object]', () => {
        const r = createRedactor({ maxDepth: 2 });
        const out = r.redactObject({ a: { b: { c: { d: 1 } } } });
        expect(out.a.b).toBe('[Object]');
    });

    test('default maxDepth is 8', () => {
        const r = createRedactor();
        let input = { leaf: 'value' };
        for (let i = 0; i < 8; i++) {
            input = { nest: input };
        }
        const out = r.redactObject(input);
        let node = out;
        for (let i = 0; i < 7; i++) {
            node = node.nest;
            expect(typeof node).toBe('object');
        }
        expect(node.nest).toBe('[Object]');
    });

    test('maxDepth: 0 collapses the top-level container', () => {
        const r = createRedactor({ maxDepth: 0 });
        expect(r.redactObject({ a: 1 })).toBe('[Object]');
        expect(r.redactObject('plain string')).toBe('plain string');
    });

    test('maxStringLength scans only the head and truncates with a marker', () => {
        const r = createRedactor({ maxStringLength: 40 });
        const long = 'AKIAIOSFODNN7EXAMPLE ' + 'x'.repeat(100) + ' AKIAIOSFODNN7EXAMPLF';
        const out = r.redactString(long);
        // Head secret redacted, tail dropped entirely.
        expect(out).toContain(REDACTED);
        expect(out).not.toContain('AKIAIOSFODNN7EXAMPLF');
        expect(out.endsWith('...[truncated]')).toBe(true);
    });

    test('maxStringLength applies inside objects', () => {
        const r = createRedactor({ maxStringLength: 10 });
        const out = r.redactObject({ blob: 'a'.repeat(50) });
        expect(out.blob).toBe('aaaaaaaaaa...[truncated]');
    });

    test('strings at or below maxStringLength are untouched', () => {
        const r = createRedactor({ maxStringLength: 10 });
        expect(r.redactString('0123456789')).toBe('0123456789');
    });

    test('invalid option values fall back to defaults', () => {
        const r = createRedactor({
            maxDepth: 'nope',
            maxStringLength: -5,
            replacement: 42,
            keys: 'not-an-array',
            patterns: 'not-an-array',
            extraKeys: 'nope',
            extraPatterns: 'nope',
        });
        expect(r.redactObject({ password: 'p' }).password).toBe(REDACTED);
        expect(r.redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
        expect(r.redactObject({ a: { b: { c: 1 } } })).toEqual({ a: { b: { c: 1 } } });
    });

    test('non-RegExp entries in the pattern list are ignored, not fatal', () => {
        const r = createRedactor({ patterns: ['not a regex', null, /\bzap\b/g] });
        expect(r.redactString('zap')).toBe(REDACTED);
    });
});

describe('secretRedaction: fast path and performance', () => {
    const r = createRedactor();

    test('an object with no secrets is deep-equal but not identical', () => {
        const input = {
            requestId: 'req-1',
            userId: 42,
            path: '/api/things',
            durationMs: 12.5,
            ok: true,
            tags: ['a', 'b'],
            meta: { region: 'us-east', retries: 0 },
        };
        const out = r.redactObject(input);
        expect(out).toEqual(input);
        expect(out).not.toBe(input);
        expect(out.tags).not.toBe(input.tags);
        expect(out.meta).not.toBe(input.meta);
    });

    test('the no-pattern fast path still deep-copies', () => {
        const noPatterns = createRedactor({ patterns: false });
        const input = { a: { b: ['c'] } };
        const out = noPatterns.redactObject(input);
        expect(out).toEqual(input);
        expect(out).not.toBe(input);
        expect(out.a).not.toBe(input.a);
    });

    test('a 20-key secret-free object redacts in well under 50us', () => {
        const obj = {};
        for (let i = 0; i < 20; i++) {
            obj['field' + i] = 'ordinary log value number ' + i;
        }
        // Warm up so the measurement is not dominated by JIT compilation.
        for (let i = 0; i < 20000; i++) {
            r.redactObject(obj);
        }
        const iterations = 20000;
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            r.redactObject(obj);
        }
        const perCallUs = Number(process.hrtime.bigint() - start) / iterations / 1000;
        expect(perCallUs).toBeLessThan(50);
    });

    test('pathological input does not hang the pattern scan', () => {
        const evil = 'Bearer ' + 'a'.repeat(5000) + '!' + 'password='.repeat(500);
        const start = Date.now();
        expect(() => r.redactString(evil)).not.toThrow();
        expect(Date.now() - start).toBeLessThan(1000);
    });
});

describe('secretRedaction: never throws', () => {
    const r = createRedactor();

    test('a proxy that throws on every trap is handled', () => {
        const hostile = new Proxy({}, {
            ownKeys() {
                throw new Error('no keys for you');
            },
            get() {
                throw new Error('no get for you');
            },
        });
        let out;
        expect(() => {
            out = r.redactObject({ hostile });
        }).not.toThrow();
        expect(out).toBeDefined();
    });

    test('an object with a throwing toString is handled', () => {
        const bad = Object.create(null);
        bad.toString = () => {
            throw new Error('nope');
        };
        expect(() => r.redactObject({ bad })).not.toThrow();
    });

    test('a throwing pattern replacement degrades to the replacement token', () => {
        const exploding = {
            get source() {
                return 'x';
            },
        };
        // A RegExp subclass whose exec explodes: redactString must swallow it.
        class BadRegExp extends RegExp {
            [Symbol.replace]() {
                throw new Error('boom');
            }
        }
        void exploding;
        const bad = createRedactor({ patterns: [new BadRegExp('x', 'g')] });
        expect(() => bad.redactString('x')).not.toThrow();
        expect(bad.redactString('x')).toBe(REDACTED);
    });

    test('a deeply recursive structure does not blow the stack', () => {
        let root = { leaf: true };
        for (let i = 0; i < 5000; i++) {
            root = { next: root };
        }
        expect(() => r.redactObject(root)).not.toThrow();
    });
});
