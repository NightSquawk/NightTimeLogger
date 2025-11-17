/**
 * @file /lib/pathReporter.js
 * @description Utility function for reporting the file path, line number, column number, and call chain where a log statement is executed.
 */

const path = require('path');

/**
 * Checks if a function name or file path is an internal Node.js function
 * @param {string} functionName - Function name to check
 * @param {string} fileName - File path to check
 * @returns {boolean} - True if internal
 */
function isInternalFunction(functionName, fileName) {
    if (!functionName && !fileName) return true;
    
    // Check for internal Node.js function names
    const internalNames = [
        '_onTimeout',
        'listOnTimeout',
        'processTimers',
        'process.nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'Promise.then',
        'Promise.catch',
        'Promise.finally',
    ];
    
    if (functionName) {
        // Check if function name starts with underscore (internal convention)
        if (functionName.startsWith('_')) {
            return true;
        }
        // Check against known internal names
        if (internalNames.includes(functionName)) {
            return true;
        }
    }
    
    // Check if file is from Node.js internals
    if (fileName) {
        if (fileName.includes('node:internal/') || 
            fileName.includes('node_modules/') ||
            fileName.includes('internal/') ||
            fileName.includes('timers.js') ||
            fileName.includes('next_tick.js') ||
            fileName.includes('promise.js')) {
            return true;
        }
    }
    
    return false;
}

/**
 * Reports the file path, line number, column number, and call chain from CallSite objects.
 * @param {Object} callSite - The CallSite object representing where the log was called (stack[1])
 * @param {Object} callerOfCaller - Optional CallSite object representing the caller of the caller (stack[2])
 * @returns {string} - Formatted string like "./path/to/file.js:123:45 [functionName ← callerFunctionName]"
 */
function reportPath(callSite, callerOfCaller = null) {
    try {
        if (!callSite) {
            return './unknown';
        }

        const file = callSite.getFileName();
        const line = callSite.getLineNumber();
        const col = callSite.getColumnNumber();

        if (!file) {
            return './unknown';
        }

        const callerName = callSite.getFunctionName() || callSite.getMethodName() || '';
        let callerOfCallerName = callerOfCaller
            ? (callerOfCaller.getFunctionName() || callerOfCaller.getMethodName() || '')
            : '';

        // Filter out internal functions from call chain
        // If caller is internal, don't include it in the chain
        const callerIsInternal = isInternalFunction(callerName, file);
        const callerOfCallerIsInternal = callerOfCaller && isInternalFunction(
            callerOfCallerName, 
            callerOfCaller.getFileName()
        );

        // Get base path (project root)
        const basePath = require.main?.path || process.cwd();

        // Build relative path
        const relativeDir = path
            .relative(basePath, path.dirname(file))
            .replace(/\\/g, '/')
            .replace(/(\.\.\/)+/g, '');

        const shortPath = './' + (relativeDir ? relativeDir + '/' : '') + path.basename(file);

        // Build the optional "call chain" string only if both are known and not internal
        let callChain = '';
        if (!callerIsInternal && !callerOfCallerIsInternal && callerName && callerOfCallerName) {
            callChain = ` [${callerName} ← ${callerOfCallerName}]`;
        } else if (!callerIsInternal && callerName && callerOfCallerName && !callerOfCallerIsInternal) {
            // Only show caller if callerOfCaller is internal
            callChain = ` [${callerName}]`;
        }

        return `${shortPath}:${line}:${col}${callChain}`;
    } catch (err) {
        console.error('Error in reportPath:', err.message);
        return './unknown';
    }
}

module.exports = {
    reportPath,
};

