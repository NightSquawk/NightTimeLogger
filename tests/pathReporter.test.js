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

    test('treats files matching timer/next_tick/promise heuristics as internal', () => {
        const mockCallSite = {
            getFileName: () => '/project/src/file.js',
            getLineNumber: () => 1,
            getColumnNumber: () => 1,
            getFunctionName: () => 'app',
            getMethodName: () => null,
        };
        const mockCaller = {
            getFileName: () => 'timers.js',
            getFunctionName: () => 'callerFn',
            getMethodName: () => null,
        };

        const originalMain = require.main;
        require.main = { path: '/project' };
        const result = reportPath(mockCallSite, mockCaller);
        require.main = originalMain;

        // callerFn should be filtered because its file matches the timers heuristic
        expect(result).toContain('file.js:1:1');
        expect(result).not.toContain('callerFn');
    });

    test('returns ./unknown when callSite throws while extracting info', () => {
        const exploding = {
            getFileName: () => { throw new Error('cannot read'); },
            getLineNumber: () => 1,
            getColumnNumber: () => 1,
            getFunctionName: () => '',
            getMethodName: () => null,
        };
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const result = reportPath(exploding);
        errSpy.mockRestore();
        expect(result).toBe('./unknown');
    });

    test('safely handles files outside the project base path', () => {
        const mockCallSite = {
            getFileName: () => '/elsewhere/secret/file.js',
            getLineNumber: () => 5,
            getColumnNumber: () => 2,
            getFunctionName: () => 'fn',
            getMethodName: () => null,
        };

        const originalMain = require.main;
        require.main = { path: '/project' };
        const result = reportPath(mockCallSite);
        require.main = originalMain;

        // Path-traversal guard should collapse the ../.. and leave us with just the basename
        expect(result).toContain('file.js:5:2');
        expect(result).not.toMatch(/\.\.\//);
    });
});

