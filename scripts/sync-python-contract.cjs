'use strict';
// JavaScript redaction defaults are canonical. Ship a portable snapshot in the
// companion wheel; CI checks it rather than regenerating it silently.
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_KEYS, DEFAULT_PATTERNS } = require('../lib/secretRedaction');
const data = {
    version: 1,
    keys: DEFAULT_KEYS,
    patterns: DEFAULT_PATTERNS.map(re => ({ source: re.source, flags: re.flags })),
    pythonLevels: { 5: 10, 10: 20, 20: 30, 30: 40, 40: 50, 50: 60 },
    contextAliases: {
        agent_uuid: 'agentUuid', tenant_id: 'tenantId', command_id: 'commandId',
        collection_cycle_id: 'collectionCycleId', correlation_id: 'correlationId',
        run_id: 'runId', work_id: 'workId', stage_id: 'stageId', device_id: 'deviceId',
        trace_id: 'traceId', span_id: 'spanId',
    },
};
const contents = JSON.stringify(data, null, 2) + '\n';
for (const name of ['contract/redaction.json', 'python/src/ntlogger/contract.json']) {
    const target = path.join(__dirname, '..', name);
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(target, 'utf8') !== contents) throw new Error(`Stale contract: ${name}; run node scripts/sync-python-contract.cjs`);
    } else fs.writeFileSync(target, contents);
}
