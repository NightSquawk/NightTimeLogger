'use strict';
const { RuleTester } = require('eslint');
const rule = require('../eslint').rules['prefer-object-first'];
new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } }).run('prefer-object-first', rule, {
    valid: [
        "log.info({ deviceId }, 'scan started')",
        "log.info('static message')",
        'console.info(`device ${deviceId}`)',
        { code: 'log.info(`device ${deviceId}`)', options: [{ loggerNames: ['custom'] }] },
    ],
    invalid: [
        { code: 'const deviceId = "d1"; log.info(`scan ${deviceId}`)',
            output: 'const deviceId = "d1"; log.info({ deviceId }, `scan ${deviceId}`)', errors: [{ messageId: 'structured' }] },
        { code: 'const id = 1; req.log.warn(`job ${id} ${id}`)',
            output: 'const id = 1; req.log.warn({ id }, `job ${id} ${id}`)', errors: 1 },
        { code: 'log.error(`failed ${error.message}`)', output: null, errors: 1 },
        { code: 'let id = 1; logger.info(`job ${id}`)', output: null, errors: 1 },
        { code: 'logger.info(`job ${nextId()}`)', output: null, errors: 1 },
        { code: 'const id = {}; logger.info(`job ${id}`)', output: null, errors: 1 },
        { code: 'const id = 1; logger.info(`job ${id}`, extra)', output: null, errors: 1 },
        { code: 'this.audit.info(`job ${id}`)', options: [{ loggerNames: ['this.audit'] }], output: null, errors: 1 },
    ],
});
