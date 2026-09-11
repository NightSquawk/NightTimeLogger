/**
 * @file /plugins/postgres.js
 * @description Stores logs in PostgresSQL database.
 *
 * `pg` is an optional peer dependency. Install it when using this plugin:
 *   npm install pg
 */

const Transport = require('winston-transport');
const levels = require('../lib/levels');

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
            throw new Error(`ntlogger Postgres plugin requires '${packageName}'. Install it with: npm install ${packageName}`);
        }
        throw err;
    }
}

const { Pool } = requirePeer('pg', 'pg');



class PostgreSQLTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'PostgreSQL Transport for NTLogger';
        this.database = opts.database || 'test';
        this.table = opts.table || 'logs';
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) {
            throw new Error('Log table must be a simple SQL identifier');
        }
        this.tableInitialized = false;
        this.closed = false;

        this.logLevel = opts.level ? levels[opts.level] : levels.info;

        this.poolConfig = {
            host: opts.host || 'localhost',
            port: opts.port || 5432,
            user: opts.user || 'postgres',
            password: opts.password || '',
            database: this.database,
            ssl: opts.ssl,
            max: opts.connectionLimit || 10,
            idleTimeoutMillis: opts.idleTimeout || 60000,
            connectionTimeoutMillis: opts.connectionTimeout || 2000,
        };

        this.pool = new Pool(this.poolConfig);
        this.pool.on('error', error => { this.lastError = error; });
        this.ready = this.checkLogTable();
        this.ready.catch(error => { this.lastError = error; });
    }

    async init() { return this.ready; }

    async log(info, callback) {
        if (levels[info.level] > this.logLevel) { callback(); return; }
        try {
            if (this.closed) throw new Error('Database transport is closed');
            await this.ready;
            const { level, message, ...meta } = info;
            const timestamp = this.formatTimestamp(meta.timestamp);
            await this.pool.query(
                `INSERT INTO ${this.table} (level, message, meta, timestamp) VALUES ($1, $2, $3, $4)`,
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
            return date.toISOString();
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

    checkLogTable() {
        if (!this.tableReady) {
            this.tableReady = this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (id SERIAL PRIMARY KEY, level VARCHAR(255) NOT NULL, message TEXT NOT NULL, meta JSONB, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`)
                .then(() => { this.tableInitialized = true; })
                .catch(error => { this.tableReady = null; throw error; });
        }
        return this.tableReady;
    }

    isActive() {
        return this.pool && !this.closed;
    }

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
    transport: PostgreSQLTransport,
};