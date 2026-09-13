const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, createPinoOptions, createTestLogger } = require('../../pino');
test('automatic silence inside the Node test runner', async () => {
    assert.ok(process.env.NODE_TEST_CONTEXT);
    const log = createLogger();
    assert.equal(log.level, 'silent');
    assert.equal(createPinoOptions().level, 'silent');
    log.info('SHOULD_NOT_EMIT');
    await log.close();
    const { logger, records } = createTestLogger();
    logger.info('captured');
    assert.equal(records[0].msg, 'captured');
    await logger.close();
});
