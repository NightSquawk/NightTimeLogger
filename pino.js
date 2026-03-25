'use strict';

// Re-export the transport for use with Pino's transport option
// Usage: transport: { target: 'ntlogger/pino' }
module.exports = require('./transports/pino');

// Helper for creating a pre-configured Pino instance
module.exports.createLogger = function (opts = {}) {
  const pino = require('pino');
  const path = require('path');

  const isDev = process.env.NODE_ENV !== 'production';
  const level = opts.level || process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

  const loggerOpts = {
    level,
  };

  // Add module name as a mixin if provided
  if (opts.module) {
    loggerOpts.mixin = () => ({ module: opts.module });
  }

  // In dev: use NTL formatter. In production: plain JSON.
  if (isDev) {
    loggerOpts.transport = {
      target: path.join(__dirname, 'transports', 'pino.js'),
      options: {
        defaultModule: opts.module || opts.defaultModule,
        colorize: opts.colorize,
      },
    };
  }

  return pino(loggerOpts);
};
