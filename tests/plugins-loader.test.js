/**
 * @file /tests/plugins-loader.test.js
 * @description Tests for the plugin loader error/skip branches in plugins/index.js.
 *              CLAUDE.md guarantees "Failed plugins are logged and skipped, never crash the logger."
 */

const { initPlugins } = require('../plugins');

describe('Plugin loader (plugins/index.js)', () => {
    let errorSpy;
    let logSpy;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        logSpy.mockRestore();
    });

    test('returns empty array when no plugins are iterable', () => {
        const result = initPlugins({});
        expect(result).toEqual([]);
    });

    test('returns empty array for empty plugin list', () => {
        const result = initPlugins([]);
        expect(result).toEqual([]);
    });

    test('skips plugin missing a name', () => {
        const result = initPlugins([
            { enabled: true, config: {} },
        ]);
        expect(result).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
            'Error initializing plugins:',
            'Plugin name is required'
        );
    });

    test('skips disabled plugins silently', () => {
        const result = initPlugins([
            { name: 'Jest', enabled: false, config: {} },
        ]);
        expect(result).toEqual([]);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    test('skips unknown plugin names without crashing', () => {
        const result = initPlugins([
            { name: 'NotARealPlugin', enabled: true, config: {} },
        ]);
        expect(result).toEqual([]);
        const calls = errorSpy.mock.calls.map(call => call.join(' '));
        expect(calls.some(c => c.includes('NotARealPlugin'))).toBe(true);
    });

    test('skips plugin with missing config object', () => {
        const result = initPlugins([
            { name: 'Jest', enabled: true },
        ]);
        expect(result).toEqual([]);
        const calls = errorSpy.mock.calls.map(call => call.join(' '));
        expect(calls.some(c => c.includes('Invalid or missing config'))).toBe(true);
    });

    test('skips plugin with non-object config', () => {
        const result = initPlugins([
            { name: 'Jest', enabled: true, config: 'not-an-object' },
        ]);
        expect(result).toEqual([]);
        const calls = errorSpy.mock.calls.map(call => call.join(' '));
        expect(calls.some(c => c.includes('Invalid or missing config'))).toBe(true);
    });

    test('one bad plugin does not block subsequent good plugins', () => {
        const result = initPlugins([
            { name: 'NotARealPlugin', enabled: true, config: {} },
            { name: 'Jest', enabled: true, config: {} },
        ]);
        expect(result.length).toBe(1);
        expect(result[0].name).toBe('JestTransport');
    });

    test('returns transport instances for valid enabled plugins', () => {
        const result = initPlugins([
            { name: 'Jest', enabled: true, config: {} },
        ]);
        expect(result.length).toBe(1);
        expect(typeof result[0].log).toBe('function');
    });
});
