const { InMemoryLogRecordExporter } = require('@opentelemetry/sdk-logs');
const { transport: OpenTelemetry } = require('../plugins/otel');
const createLogger = require('../');

test.each([false, true])('supported real SDK exports records with simple processor = %s', async useSimpleProcessor => {
    const exporter = new InMemoryLogRecordExporter();
    const transport = new OpenTelemetry({ exporter, useSimpleProcessor, serviceName: 'ntlogger-test' });
    const logger = createLogger('otel-real', { console: false, file: false, skipCache: true });
    logger.add(transport);
    logger.info('real SDK', { requestId: 7 });
    await logger.flush();
    const records = exporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe('real SDK');
    expect(records[0].attributes.requestId).toBe(7);
    expect(records[0].resource.attributes['service.name']).toBe('ntlogger-test');
    expect(records[0].hrTime[0]).toBeGreaterThan(0);
    await logger.close();
});
