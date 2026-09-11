/**
 * @file /plugins/mysql.js
 * @description Stores logs in MySQL database.
 *
 * `mysql2` is an optional peer dependency. Install it when using this plugin:
 *   npm install mysql2
 */

const Transport = require('winston-transport');

/**
 * Requires an optional peer dependency, translating only that package's
 * MODULE_NOT_FOUND into an actionable install message. Any other failure
 * (including a missing module *inside* the package) propagates unchanged.
 * @param {string} moduleId - The module specifier to require.
 * @param {string} packageName - The npm package to install.
 * @returns {*} The resolved module.
 */
function requirePeer(moduleId, packageName) {
    try {
        return require(moduleId);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${moduleId}'`)) {
            throw new Error(`ntlogger MySQL plugin requires '${packageName}'. Install it with: npm install ${packageName}`);
        }
        throw err;
    }
}

const mysql = requirePeer('mysql2/promise', 'mysql2');



class MySQLTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'MySQL Transport for NTLogger';
        this.database = opts.database || 'test';
        this.table = opts.table || 'logs';
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) {
            throw new Error('Log table must be a simple SQL identifier');
        }
        this.tableInitialized = false;
        this.closed = false;

        this.levels = {
            internal: 6,
            trace: 5,
            debug: 4,
            info: 3,
            warn: 2,
            error: 1,
            fatal: 0,
        };
        this.logLevel = opts.level ? this.levels[opts.level] : this.levels.info;

        this.poolConfig = {
            host: opts.host || 'localhost',
            port: opts.port || 3306,
            user: opts.user || 'root',
            password: opts.password || '',
            database: this.database,
            ssl: opts.ssl,
            timezone: "+00:00",
            waitForConnections: opts.waitForConnections ?? true,
            connectionLimit: opts.connectionLimit || 10,
            queueLimit: opts.queueLimit || 0,
            maxIdle: opts.maxIdle ?? 10,
            idleTimeout: opts.idleTimeout || 60000,
            enableKeepAlive: opts.enableKeepAlive ?? true,
            keepAliveInitialDelay: opts.keepAliveInitialDelay || 0,
        };

        this.pool = mysql.createPool(this.poolConfig);
        this.pool.on('error', error => { this.lastError = error; });
        this.ready = this.checkLogTable();
        this.ready.catch(error => { this.lastError = error; });
    }

    /**
     * Initializes the MySQL connection pool and checks the log table.
     */
    async init() { return this.ready; }

    async log(info, callback) {
        if (this.levels[info.level] > this.logLevel) { callback(); return; }
        try {
            if (this.closed) throw new Error('Database transport is closed');
            await this.ready;
            const { level, message, ...meta } = info;
            const timestamp = this.formatTimestamp(meta.timestamp);
            await this.pool.execute(
                `INSERT INTO ${this.table} (level, message, meta, timestamp) VALUES (?, ?, ?, ?)`,
                [level, message, JSON.stringify(meta), timestamp]
            );
            this.emit('logged', info);
            callback();
        } catch (error) {
            this.lastError = error;
            callback(error);
        }
    }

    formatTimestamp(timeCreated) {
        if (timeCreated && /^\d{4}-/.test(timeCreated)) {
            const date = new Date(timeCreated);
            return date.toISOString().slice(0, 23).replace('T', ' ');
        }
        if (!timeCreated) {
            return new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

        const date = new Date();
        const [time, modifier] = timeCreated.split(' ');
        let [hours, minutes, seconds] = time.split(':');

        if (modifier === 'PM' && hours !== '12') {
            hours = parseInt(hours, 10) + 12;
        }
        if (modifier === 'AM' && hours === '12') {
            hours = '00';
        }

        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * Checks if the log table exists in the MySQL database. If it does not exist, it will create it.
     */
    checkLogTable() {
        if (!this.tableReady) {
            this.tableReady = this.pool.execute(`CREATE TABLE IF NOT EXISTS ${this.table} (id INT AUTO_INCREMENT PRIMARY KEY, level VARCHAR(255) NOT NULL, message TEXT NOT NULL, meta TEXT, timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3))`)
                .then(() => { this.tableInitialized = true; })
                .catch(error => { this.tableReady = null; throw error; });
        }
        return this.tableReady;
    }

    isActive() {
        return this.pool && !this.closed;
    }

    /**
     * Closes the MySQL connection pool.
     * @returns {Promise<void>}
     */
    async flush() {
        await this.ready;
        if (this.lastError) throw this.lastError;
    }

    close() {
        if (!this.closePromise) {
            this.closed = true;
            this.closePromise = this.ready.catch(() => {}).then(() => this.pool.end());
        }
        return this.closePromise;
    }

}

module.exports = {
    transport: MySQLTransport,
};
