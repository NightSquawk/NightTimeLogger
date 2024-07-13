/**
 * @file /plugins/mysql.js
 * @description Stores logs in MySQL database.
 */

const Transport = require('winston-transport');
const mysql = require('mysql2/promise');

let connectionPool = null;
let tableInitialized = false;

class MySQLTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'MySQL Transport for NTLogger';
        this.database = opts.database || 'test';
        this.table = opts.table || 'logs';

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
            waitForConnections: opts.waitForConnections || true,
            connectionLimit: opts.connectionLimit || 10,
            queueLimit: opts.queueLimit || 0,
            maxIdle: opts.maxIdle || 10,
            idleTimeout: opts.idleTimeout || 60000,
            enableKeepAlive: opts.enableKeepAlive || true,
            keepAliveInitialDelay: opts.keepAliveInitialDelay || 0,
        };

        this.init();
    }

    /**
     * Initializes the MySQL connection pool and checks the log table.
     */
    async init() {
        try {
            if (!connectionPool) {
                connectionPool = mysql.createPool(this.poolConfig);
            }
            this.pool = connectionPool;
            await this.checkLogTable();
        } catch (err) {
            console.error(`Failed to initialize ${this.name}:`, err);
        }
    }

    async log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        if (!tableInitialized) {
            await this.checkLogTable();
        }

        const { level, message, ...meta } = info;

        if (this.levels[level] > this.logLevel) {
            callback();
            return;
        }

        const metaString = JSON.stringify(meta);
        const timestamp = this.formatTimestamp(meta.timeCreated);

        try {
            await this.pool.execute(
                `INSERT INTO ${this.table} (level, message, meta, timestamp) VALUES (?, ?, ?, ?)`,
                [level, message, metaString, timestamp]
            );
        } catch (err) {
            console.error(`Failed to log message to ${this.name}:`, err);
        }

        callback();
    }

    /**
     * Formats the timestamp for the MySQL database.
     * @param {string} timeCreated - The time created string.
     * @returns {string} - The formatted timestamp.
     */
    formatTimestamp(timeCreated) {
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
    async checkLogTable() {
        if (tableInitialized) return;

        try {
            const [rows] = await this.pool.execute(
                `SELECT COUNT(*) AS count
                 FROM information_schema.tables 
                 WHERE table_schema = ? 
                 AND table_name = ?`,
                [this.database, this.table]
            );

            if (rows[0].count === 0) {
                await this.pool.execute(
                    `CREATE TABLE IF NOT EXISTS ${this.table} (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        level VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,
                        meta TEXT,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )`
                );
            }

            tableInitialized = true;
        } catch (err) {
            console.error(`Failed to check or create table ${this.table}:`, err);
        }
    }

    /**
     * Checks if the MySQL connection pool is active.
     * @returns {boolean} - True if the connection pool is active, false otherwise.
     */
    isActive() {
        return this.pool && !this.pool.ended;
    }

    /**
     * Closes the MySQL connection pool.
     * @returns {Promise<void>}
     */
    async close() {
        if (connectionPool) {
            await connectionPool.end();
            connectionPool = null;
            console.log('Closed MySQL connection pool.');
        }
    }
}

module.exports = {
    transport: MySQLTransport,
};
