// Import the logger
// const logger = require('ntlogger');

const logger = require('../lib/logger');

// Example 1: Child Loggers (perfect for multi-threaded applications)
console.log('=== Example 1: Child Loggers ===');
const parentLogger = logger('ParentApp', {
    level: 'info',
    console: true,
    file: false,
});

// Create child logger with persistent context
const requestLogger = parentLogger.child({
    requestId: 'req-12345',
    userId: 789,
    endpoint: '/api/users',
});

requestLogger.info('Processing request');
requestLogger.warn('Validation warning', { field: 'email' });
requestLogger.error('Processing failed', { error: 'Timeout' });

// Nested child logger
const operationLogger = requestLogger.child({ operation: 'validate' });
operationLogger.info('Validating input'); // Changed to info so it shows (level is 'info')

// Small delay to allow async logs to process
setTimeout(() => {
    // Example 2: Log Sampling and Rate Limiting
    console.log('\n=== Example 2: Log Sampling and Rate Limiting ===');
    const sampledLogger = logger('SampledApp', {
        level: 'debug',
        console: true,
        file: false,
        sampling: {
            debug: 0.25,  // Log only 25% of debug messages
            trace: 0.01, // Log only 1% of trace messages
        },
        rateLimit: {
            error: { max: 5, window: 10000 }, // Max 5 errors per 10 seconds
        },
        statsInterval: 15000, // Log statistics every 15 seconds
    });

    // These will be sampled
    for (let i = 0; i < 20; i++) {
        sampledLogger.debug(`Debug message ${i}`);
    }

    // These will be rate limited
    for (let i = 0; i < 10; i++) {
        sampledLogger.error(`Error message ${i}`);
    }

    // Get statistics after a delay to allow async processing
    setTimeout(() => {
        const stats = sampledLogger.getStats();
        console.log('\nStatistics:', JSON.stringify(stats, null, 2));
        
        // Example 3: Log Deduplication
        setTimeout(() => {
            console.log('\n=== Example 3: Log Deduplication ===');
            const dedupLogger = logger('DedupApp', {
                level: 'debug',
                console: true,
                file: false,
                deduplication: {
                    enabled: true,
                    threshold: 3,  // After 3 duplicates, start squishing
                    window: 60000, // 60 second window
                },
            });

            // Simulate repeated messages (like your "Ticket already exists" example)
            const thresholdId = 'a481199f-ed1c-47c6-834d-9cf54cdc394e';
            const devices = [2642, 190, 294, 2646, 2532, 2632, 27, 2431, 2861, 2707, 2030];

            devices.forEach(deviceId => {
                dedupLogger.debug(`Ticket already exists for threshold ${thresholdId} and device ${deviceId}`);
            });

            // Example 4: Performance Metrics (Development Only)
            setTimeout(() => {
                console.log('\n=== Example 4: Performance Metrics ===');
                const perfLogger = logger('PerfApp', {
                    level: 'debug',
                    console: true,
                    file: false,
                    performanceMetrics: true, // Auto-enabled in development
                });

                perfLogger.time('database-query');
                // Simulate work
                setTimeout(() => {
                    const duration = perfLogger.timeEnd('database-query');
                    if (duration !== null) {
                        console.log(`Query took ${duration.toFixed(2)}ms`);
                    }

                    perfLogger.time('api-call');
                    setTimeout(() => {
                        const duration = perfLogger.timeEnd('api-call');
                        if (duration !== null) {
                            perfLogger.debug(`API call took ${duration.toFixed(2)}ms`);
                        }
                        
                        // Example 5: Combined Features
                        setTimeout(() => {
                            console.log('\n=== Example 5: Combined Features ===');
                            const advancedLogger = logger('AdvancedApp', {
                                level: 'debug',
                                console: true,
                                file: false,
                                reportPath: true,
                                sampling: { trace: 0.1 },
                                rateLimit: { error: { max: 10, window: 60000 } },
                                deduplication: { enabled: true, threshold: 3, window: 60000 },
                                performanceMetrics: true,
                            });

                            // Create child logger
                            const taskLogger = advancedLogger.child({ taskId: 'task-001', threadId: 'thread-1' });

                            taskLogger.info('Task started');
                            taskLogger.debug('Processing data', { recordCount: 1000 });

                            // Performance tracking
                            taskLogger.time('data-processing');
                            setTimeout(() => {
                                taskLogger.timeEnd('data-processing');
                                taskLogger.info('Task completed');

                                // Wait a bit for async operations to complete
                                setTimeout(() => {
                                    console.log('\n=== Final Statistics ===');
                                    const finalStats = advancedLogger.getStats();
                                    console.log(JSON.stringify(finalStats, null, 2));
                                    
                                    // Flush and close
                                    advancedLogger.flush().then(() => {
                                        console.log('\nLogger flushed successfully');
                                        process.exit(0);
                                    }).catch(err => {
                                        console.error('Error flushing logger:', err);
                                        process.exit(1);
                                    });
                                }, 300); // Wait for async operations
                            }, 200);
                        }, 100);
                    }, 50);
                }, 100);
            }, 100);
        }, 100);
    }, 100);
}, 50); // Initial delay for Example 1 logs
