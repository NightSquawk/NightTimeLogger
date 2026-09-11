/**
 * @file /tests/plugins-optional-deps.test.js
 * @description Verifies that the heavy plugin backends (@sentry/node, mysql2, pg)
 *              behave as OPTIONAL peer dependencies: when the package is absent the
 *              plugin loader reports an actionable error and skips only that plugin,
 *              other plugins in the same config still load, and require('ntlogger')
 *              itself keeps working.
 */

const MISSING_MODULES = {
    Sentry: { moduleId: '@sentry/node', packageName: '@sentry/node' },
    MySQL: { moduleId: 'mysql2/promise', packageName: 'mysql2' },
    Postgres: { moduleId: 'pg', packageName: 'pg' },
};

/**
 * Runs `fn` in a fresh module registry where every module in `moduleIds`
 * behaves as if it were not installed.
 * @param {string[]} moduleIds
 * @param {Function} fn - Receives the freshly-required plugins/index.js exports.
 */
function withMissingModules(moduleIds, fn) {
    jest.isolateModules(() => {
        for (const moduleId of moduleIds) {
            jest.doMock(moduleId, () => {
                const err = new Error(`Cannot find module '${moduleId}'`);
                err.code = 'MODULE_NOT_FOUND';
                throw err;
            });
        }
        try {
            fn();
        } finally {
            for (const moduleId of moduleIds) {
                jest.dontMock(moduleId);
            }
        }
    });
}

describe('Optional plugin peer dependencies', () => {
    let errorSpy;
    let logSpy;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        logSpy.mockRestore();
        jest.resetModules();
    });

    describe.each(Object.entries(MISSING_MODULES))(
        '%s plugin without its package installed',
        (pluginName, { moduleId, packageName }) => {
            test('is skipped with an error naming the missing package', () => {
                withMissingModules([moduleId], () => {
                    const { initPlugins } = require('../plugins');
                    const result = initPlugins([
                        { name: pluginName, enabled: true, config: {} },
                    ]);

                    expect(result).toEqual([]);
                    const messages = errorSpy.mock.calls.map(call => call.join(' '));
                    expect(messages.some(m => m.includes(packageName))).toBe(true);
                    expect(messages.some(m => m.includes(`npm install ${packageName}`))).toBe(true);
                });
            });

            test('does not prevent other plugins from loading', () => {
                withMissingModules([moduleId], () => {
                    const { initPlugins } = require('../plugins');
                    const result = initPlugins([
                        { name: pluginName, enabled: true, config: {} },
                        { name: 'Jest', enabled: true, config: {} },
                    ]);

                    expect(result.length).toBe(1);
                    expect(result[0].name).toBe('JestTransport');
                });
            });

            test('never throws out of initPlugins', () => {
                withMissingModules([moduleId], () => {
                    const { initPlugins } = require('../plugins');
                    expect(() => initPlugins([
                        { name: pluginName, enabled: true, config: {} },
                    ])).not.toThrow();
                });
            });
        }
    );

    test('all three packages missing at once: loader still returns working plugins', () => {
        const moduleIds = Object.values(MISSING_MODULES).map(m => m.moduleId);
        withMissingModules(moduleIds, () => {
            const { initPlugins } = require('../plugins');
            const result = initPlugins([
                { name: 'Sentry', enabled: true, config: {} },
                { name: 'MySQL', enabled: true, config: {} },
                { name: 'Postgres', enabled: true, config: {} },
                { name: 'Jest', enabled: true, config: {} },
            ]);

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('JestTransport');

            const messages = errorSpy.mock.calls.map(call => call.join(' '));
            for (const { packageName } of Object.values(MISSING_MODULES)) {
                expect(messages.some(m => m.includes(`npm install ${packageName}`))).toBe(true);
            }
        });
    });

    test("require('ntlogger') does not throw when the optional packages are absent", () => {
        const moduleIds = Object.values(MISSING_MODULES).map(m => m.moduleId);
        withMissingModules(moduleIds, () => {
            let logger;
            expect(() => { logger = require('../index.js'); }).not.toThrow();
            expect(typeof logger).toBe('function');
        });
    });

    test('a logger can still be created with a Jest plugin while the optional packages are absent', () => {
        const moduleIds = Object.values(MISSING_MODULES).map(m => m.moduleId);
        withMissingModules(moduleIds, () => {
            const logger = require('../index.js');
            const log = logger('OptionalDepsTest', {
                console: false,
                file: false,
                skipCache: true,
                plugins: [{ name: 'Jest', enabled: true, config: {} }],
            });
            expect(typeof log.info).toBe('function');
        });
    });

    test('non-MODULE_NOT_FOUND failures from the package propagate unchanged', () => {
        jest.isolateModules(() => {
            jest.doMock('pg', () => {
                throw new Error('boom from inside pg');
            });
            try {
                const { initPlugins } = require('../plugins');
                const result = initPlugins([
                    { name: 'Postgres', enabled: true, config: {} },
                ]);
                expect(result).toEqual([]);
                const messages = errorSpy.mock.calls.map(call => call.join(' '));
                expect(messages.some(m => m.includes('boom from inside pg'))).toBe(true);
                expect(messages.some(m => m.includes('npm install pg'))).toBe(false);
            } finally {
                jest.dontMock('pg');
            }
        });
    });

    test('a MODULE_NOT_FOUND for a different module is not mistaken for the peer', () => {
        jest.isolateModules(() => {
            jest.doMock('pg', () => {
                const err = new Error("Cannot find module 'some-internal-pg-dep'");
                err.code = 'MODULE_NOT_FOUND';
                throw err;
            });
            try {
                const { initPlugins } = require('../plugins');
                initPlugins([{ name: 'Postgres', enabled: true, config: {} }]);
                const messages = errorSpy.mock.calls.map(call => call.join(' '));
                expect(messages.some(m => m.includes('some-internal-pg-dep'))).toBe(true);
                expect(messages.some(m => m.includes('npm install pg'))).toBe(false);
            } finally {
                jest.dontMock('pg');
            }
        });
    });
});
