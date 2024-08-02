/**
 * @file /plugins/index.js
 * @description Initializes any plugins required by the application.
 */

// Available plugins
const plugins = {
    Sentry: require('./sentry'),
    MySQL : require('./mysql'),
    Jest: require('./jest'),

    // TODO: Implement the following plugins
    // mongodb: require('./mongodb'),
    // redis: require('./redis'),
};

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
            } else {
                checkPluginAvailability(plugin.name);
                let customTransportClass = getPluginTransport(plugin.name);
                pluginTransports.push(new customTransportClass(plugin.config));
            }
        }
        return pluginTransports;
    } catch (err) {
        console.error('Error initializing plugins:', err);
    }
}

module.exports = {
    initPlugins,
};