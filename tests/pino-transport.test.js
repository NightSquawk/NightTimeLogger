'use strict';

const { formatLine, formatTimestamp, padLevel } = require('../transports/pino');

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
});
