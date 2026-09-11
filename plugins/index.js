/**
 * @file /plugins/index.js
 * @description Initializes any plugins required by the application.
 */

// Available plugins.
//
// Each entry is a *thunk*, not a module: the `require()` only runs when the
// plugin is actually requested by a config entry. Several plugins depend on
// optional peer dependencies (`@sentry/node`, `mysql2`, `pg`, the
// OpenTelemetry packages) that consumers are not required to install, so
// resolving every module at load time would break `require('ntlogger')` for
// everyone who does not use those backends. Resolution happens inside the
// per-plugin try/catch in initPlugins(), which means a missing optional
// dependency disables only that one plugin.
const plugins = {
    Sentry      : () => require('./sentry'),
    MySQL       : () => require('./mysql'),
    Postgres    : () => require('./postgres'),
    Jest        : () => require('./jest'),
    Syslog      : () => require('./syslog'),
    Discord     : () => require('./discord'),
    Teams       : () => require('./teams'),
    OpenObserve : () => require('./openobserve'),
    OpenTelemetry : () => require('./otel'),

    // WIP SMSMail : () => require('./smsMail'),
};

// ------------------------------ DO NOT MODIFY BELOW THIS LINE ------------------------------ //

function checkPluginAvailability(pluginName) {
    if (!plugins[pluginName]) {
        throw new Error(`Plugin ${pluginName} is not available\nAvailable plugins: ${Object.keys(plugins).join(', ')}`);
    }
}

/**
 * Lazily resolves a plugin module and returns its transport class.
 * Any error thrown here (including a missing optional peer dependency)
 * is reported and skipped by the caller rather than crashing the logger.
 */
function getPluginTransport(pluginName) {
    checkPluginAvailability(pluginName);
    const pluginModule = plugins[pluginName]();
    return pluginModule && pluginModule.transport;
}

/**
 * Initializes plugins named and configured in the configuration object.
 * @param {Object} config - The configuration object for the plugins
 * @param {string} config.sentry - The configuration object for Sentry
 * @returns {Array} - An array of plugin components
 */
function initPlugins(config = {}) {
    let pluginTransports = [];
    try {
        for (let plugin of config) {
            try {
                if (!plugin.name) {
                    throw new Error('Plugin name is required');
                }
            } catch (nameError) {
                console.error('Error initializing plugins:', nameError.message);
                console.error(nameError.stack);
                continue
            }

            try {
                if (!plugin.enabled) {
                    if (config.alerts === true) {console.log(`Plugin ${plugin.name} is disabled`);}
                    continue;
                }
            } catch (enabledError) {
                console.error('Error initializing plugins:', enabledError.message);
                console.error(enabledError.stack);
                continue
            }

            try {
                checkPluginAvailability(plugin.name);
            } catch (availabilityError) {
                console.error(`Plugin ${plugin.name} is not available:`, availabilityError.message);
                console.error(availabilityError.stack);
                continue;
            }

            try {
                let customTransportClass = getPluginTransport(plugin.name);

                if (typeof customTransportClass !== 'function') {
                    throw new Error(`Transport class for plugin ${plugin.name} is not a constructor function`);
                }

                if (!plugin.config || typeof plugin.config !== 'object') {
                    throw new Error(`Invalid or missing config for plugin ${plugin.name}`);
                }

                pluginTransports.push(new customTransportClass(plugin.config));
            } catch (transportError) {
                console.error(`Failed to initialize plugin ${plugin.name}:`, transportError.message);
                console.error(transportError.stack);
            }
        }
    } catch (err) {
        console.error('Error initializing plugins:', err.message);
        console.error(err.stack);
    }

    return pluginTransports;
}

module.exports = {
    initPlugins,
};