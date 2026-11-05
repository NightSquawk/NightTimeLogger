const logger = require('../');
const levels = require('../lib/levels');

const config = {
    console: false,
    file: false,
    plugins: [{ name: 'Jest', enabled: true, config: {} }],
};

const expectedError = 'Invalid log level. Expected one of: internal, trace, debug, info, warn, error, fatal.';

describe('Winston configuration feedback', () => {
    test.each(['DEBUG', 'warning', '', null, 3, {}, 'constructor', '__proto__'])(
        'rejects unsupported level %p with supported choices', level => {
            expect(() => logger('invalid-level', { ...config, level })).toThrow(expectedError);
        },
    );

    test.each(Object.keys(levels))('accepts %s and delivers records', async level => {
        const log = logger(`valid-${level}`, { ...config, level, skipCache: true });
        try {
            log[level]('visible');
            await log.flush();
            expect(log.transports[0].getMessages()).toEqual([
                expect.objectContaining({ level, message: 'visible' }),
            ]);
        } finally {
            await log.close();
        }
    });

    test('omitted and undefined levels retain the info default', async () => {
        for (const options of [{}, { level: undefined }]) {
            const log = logger('default-level', { ...config, ...options, skipCache: true });
            expect(log.level).toBe('info');
            await log.close();
        }
    });

    test('validates before plugins initialize or a cached logger is returned', async () => {
        const log = logger('cached-level', config);
        const plugins = jest.fn(() => []);
        try {
            expect(() => logger('cached-level', {
                level: 'warning',
                get plugins() { return plugins(); },
            })).toThrow(expectedError);
            expect(plugins).not.toHaveBeenCalled();
            expect(logger('cached-level')).toBe(log);
            log.error('still usable');
            await log.flush();
            expect(log.transports[0].getMessages()).toEqual([
                expect.objectContaining({ level: 'error', message: 'still usable' }),
            ]);
        } finally {
            await log.close();
        }
    });
});
