/**
 * @file /lib/pathReporter.js
 * @description Utility function for reporting the file path, line number, column number, and call chain where a log statement is executed.
 */

const path = require('path');

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
        const callerOfCallerName = callerOfCaller
            ? (callerOfCaller.getFunctionName() || callerOfCaller.getMethodName() || '')
            : '';

        // Get base path (project root)
        const basePath = require.main?.path || process.cwd();

        // Build relative path
        const relativeDir = path
            .relative(basePath, path.dirname(file))
            .replace(/\\/g, '/')
            .replace(/(\.\.\/)+/g, '');

        const shortPath = './' + (relativeDir ? relativeDir + '/' : '') + path.basename(file);

        // Build the optional "call chain" string only if both are known
        let callChain = '';
        if (callerName && callerOfCallerName) {
            callChain = ` [${callerName} ← ${callerOfCallerName}]`;
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

