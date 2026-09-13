'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const api = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { createTestLogger } = require('../../pino');

(async () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    api.context.setGlobalContextManager(manager);
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            requests.push(JSON.parse(body));
            res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const exporter = new OTLPLogExporter({ url: `http://127.0.0.1:${server.address().port}/v1/logs` });
    const provider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({ exporter })] });
    const { logger } = createTestLogger({ otel: { loggerProvider: provider } });
    const spanContext = { traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef', traceFlags: 1 };
    try {
        api.context.with(api.trace.setSpanContext(api.ROOT_CONTEXT, spanContext), () => {
            logger.warn({ token: 'collector-secret' }, 'OTLP delivered');
        });
        assert.deepEqual(await logger.close(), { drained: true });
        assert.equal(requests.length, 1);
        const record = requests[0].resourceLogs[0].scopeLogs[0].logRecords[0];
        assert.equal(record.traceId, spanContext.traceId);
        assert.equal(record.spanId, spanContext.spanId);
        assert.equal(record.severityNumber, 13);
        assert.equal(record.body.stringValue, 'OTLP delivered');
        assert.ok(!JSON.stringify(requests).includes('collector-secret'));
        console.log('OTLP correlation and redaction verified');
    } finally {
        try { await logger.close(); await provider.shutdown(); }
        finally { await new Promise(resolve => server.close(resolve)); api.context.disable(); manager.disable(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
