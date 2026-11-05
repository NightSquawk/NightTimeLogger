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

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
const usage = readme.split('## Usage\n')[1].split('```javascript\n')[1].split('```')[0];
const quickStart = fs.readFileSync(path.join(__dirname, '../examples/quick-start.js'), 'utf8');

test.each([['README usage', usage], ['quick-start example', quickStart]])(
    '%s shows all demonstrated levels without file transports', async (name, source) => {
        let log;
        const factory = (location, options) => {
            expect(options).toMatchObject({ level: 'internal', file: false });
            log = logger(location, { ...config, ...options, console: false, skipCache: true });
            return log;
        };
        try {
            vm.runInNewContext(source, { require: () => factory });
            await log.flush();
            expect(log.transports.map(transport => transport.name)).toEqual(['JestTransport']);
            expect(log.transports[0].getMessages().map(record => record.level)).toEqual([
                'info', 'warn', 'error', 'debug', 'trace', 'internal',
            ]);
        } finally {
            if (log) await log.close();
        }
    },
);
