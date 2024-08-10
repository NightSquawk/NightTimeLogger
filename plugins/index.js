/**
 * @file /plugins/index.js
 * @description Initializes any plugins required by the application.
 */

// Available plugins
const plugins = {
    Sentry: require('./sentry'),
    MySQL : require('./mysql'),
    Jest: require('./jest'),
    Syslog: require('./syslog'),
    Discord: require('./discord'),
};

// ------------------------------ DO NOT MODIFY BELOW THIS LINE ------------------------------ //

function checkPluginAvailability(pluginName) {
    if (!plugins[pluginName]) {
        throw new Error(`Plugin ${pluginName} is not available\nAvailable plugins: ${Object.keys(plugins).join(', ')}`);
    }
}

function getPluginTransport(pluginName) {
    checkPluginAvailability(pluginName);
    return plugins[pluginName].transport;
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
            if (!plugin.name) {
                throw new Error('Plugin name is required');
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