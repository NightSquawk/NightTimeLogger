'use strict';

const {
  formatLine,
  formatTimestamp,
  padLevel,
  formatContext,
  createRequestTracker,
  CONTEXT_KEYS,
} = require('../transports/pino');

describe('Pino Transport', () => {
  describe('formatTimestamp', () => {
    test('formats epoch to YYYY-MM-DD HH:mm:ss', () => {
      const epoch = new Date('2026-03-25T10:30:45.000Z').getTime();
      const result = formatTimestamp(epoch);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('padLevel', () => {
    test('pads to 8 chars', () => {
      expect(padLevel('info')).toBe('info    ');
      expect(padLevel('warn')).toBe('warn    ');
      expect(padLevel('error')).toBe('error   ');
      expect(padLevel('fatal')).toBe('fatal   ');
    });
  });

  describe('formatLine', () => {
    test('formats basic info message', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'Server started',
        module: 'API',
      });
      expect(line).toContain('[info    ]');
      expect(line).toContain('[API]');
      expect(line).toContain('Server started');
    });

    test('formats HTTP request completion', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        reqId: 'req-1',
        module: 'API',
        req: { method: 'GET', url: '/api/v1/devices' },
        res: { statusCode: 200 },
        responseTime: 12.456,
      });
      expect(line).toContain('[ID: req-1]');
      expect(line).toContain('GET /api/v1/devices');
      expect(line).toContain('200');
      expect(line).toContain('12.5ms');
    });

    test('formats error with stack trace', () => {
      const line = formatLine({
        level: 50,
        time: Date.now(),
        msg: 'Database connection failed',
        module: 'DB',
        err: {
          message: 'ECONNREFUSED',
          stack: 'Error: ECONNREFUSED\n    at connect (net.js:123)',
        },
      });
      expect(line).toContain('[error   ]');
      expect(line).toContain('[DB]');
      expect(line).toContain('ECONNREFUSED');
    });

    test('uses default module from options', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'Hello',
      }, { defaultModule: 'MyApp' });
      expect(line).toContain('[MyApp]');
    });

    test('formats message without module or ID', () => {
      const line = formatLine({
        level: 40,
        time: Date.now(),
        msg: 'Something happened',
      });
      expect(line).toContain('[warn    ]');
      expect(line).toContain('Something happened');
      expect(line).not.toContain('[ID:');
    });

    test('status code coloring — 4xx vs 5xx', () => {
      const line4xx = formatLine({
        level: 40,
        time: Date.now(),
        reqId: 'r1',
        req: { method: 'POST', url: '/login' },
        res: { statusCode: 401 },
        responseTime: 5.0,
      });
      expect(line4xx).toContain('401');

      const line5xx = formatLine({
        level: 50,
        time: Date.now(),
        reqId: 'r2',
        req: { method: 'GET', url: '/crash' },
        res: { statusCode: 500 },
        responseTime: 1.2,
      });
      expect(line5xx).toContain('500');
    });

    test('handles unknown level gracefully', () => {
      const line = formatLine({
        level: 99,
        time: Date.now(),
        msg: 'custom level',
      });
      expect(line).toContain('[unknown ]');
      expect(line).toContain('custom level');
    });
  });

  describe('structured context suffix', () => {
    test('renders only the context keys that are present', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'tenant scoped',
        module: 'API',
        tenantId: 't-1',
        correlationId: 'c-9',
      }, { colorize: false });
      expect(line).toContain('{tenantId=t-1 correlationId=c-9}');
      expect(line).toContain('tenant scoped');
    });

    test('renders context in declared key order, after the module label', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'ordered',
        module: 'API',
        commandId: 'cmd-4',
        userId: 'u-2',
        traceId: 'tr-3',
      }, { colorize: false });
      expect(line).toContain('[API]: {userId=u-2 traceId=tr-3 commandId=cmd-4} ordered');
    });

    test('supports every documented context key', () => {
      const obj = { level: 30, time: Date.now(), msg: 'all keys' };
      for (const key of CONTEXT_KEYS) obj[key] = `v-${key}`;
      const line = formatLine(obj, { colorize: false });
      for (const key of CONTEXT_KEYS) expect(line).toContain(`${key}=v-${key}`);
    });

    test('omits the suffix entirely when no context keys are present', () => {
      const line = formatLine({ level: 30, time: Date.now(), msg: 'plain' }, { colorize: false });
      expect(line).not.toContain('{');
    });

    test('skips null, undefined and empty-string context values', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'partial',
        tenantId: 't-1',
        userId: null,
        correlationId: undefined,
        traceId: '',
      }, { colorize: false });
      expect(line).toContain('{tenantId=t-1}');
    });

    test('context suffix is dim and stripped by colorize:false', () => {
      const obj = { level: 30, time: Date.now(), msg: 'dim', tenantId: 't-1' };
      expect(formatLine(obj)).toContain('\x1b[2m{tenantId=t-1}\x1b[0m');
      expect(formatLine(obj, { colorize: false })).not.toContain('\x1b[');
    });

    test('formatContext is exported and returns empty string with no keys', () => {
      expect(formatContext({})).toBe('');
      expect(formatContext({ jobId: 'j-1' })).toContain('{jobId=j-1}');
    });
  });

  describe('in-flight request tracking', () => {
    test('pairs a request-start line with its completion line', () => {
      const tracker = createRequestTracker();
      const opts = { colorize: false, defaultModule: 'API' };

      const start = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'incoming request',
        reqId: 'req-7',
        req: { method: 'GET', url: '/api/v1/devices' },
      }, opts, tracker);
      expect(start).toContain('GET /api/v1/devices');
      expect(start).not.toContain('incoming request');
      expect(tracker.size).toBe(1);

      const done = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        reqId: 'req-7',
        res: { statusCode: 201 },
        responseTime: 8.42,
      }, opts, tracker);
      expect(done).toContain('GET /api/v1/devices — 201 (8.4ms)');
      // Entry is consumed, so it cannot leak.
      expect(tracker.size).toBe(0);
    });

    test('keeps a non-generic request-start message alongside method and url', () => {
      const tracker = createRequestTracker();
      const line = formatLine({
        level: 40,
        time: Date.now(),
        msg: 'rate limit warning',
        reqId: 'req-8',
        req: { method: 'POST', url: '/login' },
      }, { colorize: false }, tracker);
      expect(line).toContain('POST /login — rate limit warning');
    });

    test('tracks requests keyed by requestId and sessionId too', () => {
      const tracker = createRequestTracker();
      const opts = { colorize: false };
      formatLine({
        level: 30, time: Date.now(), requestId: 'rid-1',
        req: { method: 'PUT', url: '/a' },
      }, opts, tracker);
      formatLine({
        level: 30, time: Date.now(), sessionId: 'sid-1',
        req: { method: 'DELETE', url: '/b' },
      }, opts, tracker);

      expect(formatLine({
        level: 30, time: Date.now(), requestId: 'rid-1',
        res: { statusCode: 200 }, responseTime: 1,
      }, opts, tracker)).toContain('PUT /a — 200 (1.0ms)');
      expect(formatLine({
        level: 30, time: Date.now(), sessionId: 'sid-1',
        res: { statusCode: 204 }, responseTime: 2,
      }, opts, tracker)).toContain('DELETE /b — 204 (2.0ms)');
      expect(tracker.size).toBe(0);
    });

    test('inline req wins over the tracked entry and still clears it', () => {
      const tracker = createRequestTracker();
      const opts = { colorize: false };
      formatLine({
        level: 30, time: Date.now(), reqId: 'req-9',
        req: { method: 'GET', url: '/stale' },
      }, opts, tracker);

      const done = formatLine({
        level: 30, time: Date.now(), reqId: 'req-9',
        req: { method: 'GET', url: '/fresh' },
        res: { statusCode: 200 }, responseTime: 3,
      }, opts, tracker);
      expect(done).toContain('GET /fresh — 200 (3.0ms)');
      expect(done).not.toContain('/stale');
      expect(tracker.size).toBe(0);
    });

    test('unmatched response falls back to msg + status', () => {
      const tracker = createRequestTracker();
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        reqId: 'never-seen',
        res: { statusCode: 502 },
        responseTime: 4.5,
      }, { colorize: false }, tracker);
      expect(line).toContain('request completed — 502 (4.5ms)');
      expect(tracker.size).toBe(0);
    });

    test('unmatched response with no msg renders status only', () => {
      const tracker = createRequestTracker();
      const line = formatLine({
        level: 50,
        time: Date.now(),
        res: { statusCode: 500 },
        responseTime: 11,
      }, { colorize: false }, tracker);
      expect(line.trim().endsWith('500 (11.0ms)')).toBe(true);
    });

    test('response without a tracker behaves exactly as before', () => {
      const line = formatLine({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        reqId: 'req-10',
        res: { statusCode: 200 },
        responseTime: 1.5,
      }, { colorize: false });
      expect(line).toContain('request completed — 200 (1.5ms)');
    });
  });

  describe('request tracker bounding', () => {
    test('caps the number of tracked requests, evicting oldest first', () => {
      const tracker = createRequestTracker({ maxInflightRequests: 3 });
      for (let i = 0; i < 5; i++) tracker.track(`id-${i}`, 'GET', `/r${i}`);
      expect(tracker.size).toBe(3);
      expect(tracker.take('id-0')).toBeNull();
      expect(tracker.take('id-1')).toBeNull();
      expect(tracker.take('id-4')).toEqual({ method: 'GET', url: '/r4' });
    });

    test('expires entries older than the TTL', () => {
      const tracker = createRequestTracker({ inflightTtlMs: 1000 });
      const t0 = 1_000_000;
      tracker.track('old', 'GET', '/old', t0);
      tracker.track('mid', 'GET', '/mid', t0 + 500);
      expect(tracker.size).toBe(2);

      // Inserting later sweeps everything past the TTL off the head.
      // 'old' is 1200ms stale, 'mid' only 700ms.
      tracker.track('new', 'GET', '/new', t0 + 1200);
      expect(tracker.size).toBe(2);
      expect(tracker.take('old')).toBeNull();
      expect(tracker.take('mid')).toEqual({ method: 'GET', url: '/mid' });
      expect(tracker.take('new')).toEqual({ method: 'GET', url: '/new' });
    });

    test('prune can be called directly with a clock value', () => {
      const tracker = createRequestTracker({ inflightTtlMs: 50 });
      tracker.track('a', 'GET', '/a', 0);
      tracker.track('b', 'GET', '/b', 10);
      tracker.prune(100);
      expect(tracker.size).toBe(0);
    });

    test('re-tracking an id refreshes its position instead of duplicating', () => {
      const tracker = createRequestTracker({ maxInflightRequests: 2 });
      tracker.track('a', 'GET', '/a', 1);
      tracker.track('b', 'GET', '/b', 2);
      tracker.track('a', 'POST', '/a2', 3);
      expect(tracker.size).toBe(2);
      tracker.track('c', 'GET', '/c', 4);
      // 'b' was the oldest after 'a' moved to the tail.
      expect(tracker.take('b')).toBeNull();
      expect(tracker.take('a')).toEqual({ method: 'POST', url: '/a2' });
    });

    test('ignores falsy ids and unknown lookups', () => {
      const tracker = createRequestTracker();
      tracker.track(null, 'GET', '/x');
      tracker.track('', 'GET', '/x');
      expect(tracker.size).toBe(0);
      expect(tracker.take(null)).toBeNull();
      expect(tracker.take('nope')).toBeNull();
    });

    test('falls back to defaults for invalid bound options', () => {
      const tracker = createRequestTracker({ maxInflightRequests: 0, inflightTtlMs: -5 });
      expect(tracker.maxInflightRequests).toBe(1000);
      expect(tracker.inflightTtlMs).toBe(60000);
    });

    test('a long stream of never-completed requests stays bounded', () => {
      const tracker = createRequestTracker({ maxInflightRequests: 10 });
      const opts = { colorize: false };
      for (let i = 0; i < 500; i++) {
        formatLine({
          level: 30, time: Date.now(), reqId: `leak-${i}`,
          req: { method: 'GET', url: `/leak/${i}` },
        }, opts, tracker);
      }
      expect(tracker.size).toBe(10);
    });
  });
});
