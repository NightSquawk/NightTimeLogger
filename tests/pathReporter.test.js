/**
 * @file /tests/pathReporter.test.js
 * @description Tests for pathReporter module
 */

const { reportPath } = require('../lib/pathReporter');

describe('PathReporter Tests', () => {
    test('should return unknown for null callSite', () => {
        const result = reportPath(null);
        expect(result).toBe('./unknown');
    });

    test('should return unknown for callSite without file', () => {
        const mockCallSite = {
            getFileName: () => null,
            getLineNumber: () => 10,
            getColumnNumber: () => 5,
        };
        const result = reportPath(mockCallSite);
        expect(result).toBe('./unknown');
    });

    test('should format path correctly', () => {
        const mockCallSite = {
            getFileName: () => '/project/src/file.js',
            getLineNumber: () => 42,
            getColumnNumber: () => 10,
            getFunctionName: () => 'testFunction',
            getMethodName: () => null,
        };
        const mockCaller = {
            getFileName: () => '/project/src/parent.js',
            getFunctionName: () => 'parentFunction',
            getMethodName: () => null,
        };
        
        // Mock require.main.path
        const originalMain = require.main;
        require.main = { path: '/project' };
        
        const result = reportPath(mockCallSite, mockCaller);
        
        // Restore require.main
        require.main = originalMain;
        
        expect(result).toContain('file.js:42:10');
        expect(result).toContain('testFunction');
        expect(result).toContain('parentFunction');
    });

    test('should filter out internal functions', () => {
        const mockCallSite = {
            getFileName: () => '/project/src/file.js',
            getLineNumber: () => 42,
            getColumnNumber: () => 10,
            getFunctionName: () => 'userFunction',
            getMethodName: () => null,
        };
        const mockCaller = {
            getFileName: () => 'node:internal/timers.js',
            getFunctionName: () => '_onTimeout',
            getMethodName: () => null,
        };
        
        const originalMain = require.main;
        require.main = { path: '/project' };
        
        const result = reportPath(mockCallSite, mockCaller);
        
        require.main = originalMain;
        
        // Should still show file path but not internal functions in call chain
        expect(result).toContain('file.js:42:10');
        expect(result).not.toContain('_onTimeout');
    });
});

