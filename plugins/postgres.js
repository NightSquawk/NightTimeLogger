/**
 * @file /plugins/postgres.js
 * @description Stores logs in PostgresSQL database.
 */

const Transport = require('winston-transport');
const { Pool } = require('pg');
const levels = require('../lib/levels');

let connectionPool = null;
let tableInitialized = false;

class PostgreSQLTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'PostgreSQL Transport for NTLogger';
        this.database = opts.database || 'test';
        this.table = opts.table || 'logs';

        this.logLevel = opts.level ? levels[opts.level] : levels.info;

        this.poolConfig = {
            host: opts.host || 'localhost',
            port: opts.port || 5432,
            user: opts.user || 'postgres',
            password: opts.password || '',
            database: this.database,
            max: opts.connectionLimit || 10,
            idleTimeoutMillis: opts.idleTimeout || 60000,
            connectionTimeoutMillis: opts.connectionTimeout || 2000,
        };

        this.init();
    }

    async init() {
        try {
            if (!connectionPool) {
                connectionPool = new Pool(this.poolConfig);
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

        if (levels[level] > this.logLevel) {
            callback();
            return;
        }

        const metaString = JSON.stringify(meta);
        const timestamp = this.formatTimestamp(meta.timeCreated);

        try {
            await this.pool.query(
                `INSERT INTO ${this.table} (level, message, meta, timestamp) VALUES ($1, $2, $3, $4)`,
                [level, message, metaString, timestamp]
            );
        } catch (err) {
            console.error(`Failed to log message to ${this.name}:`, err);
        }

        callback();
    }

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

    async checkLogTable() {
        if (tableInitialized) return;

        try {
            const result = await this.pool.query(
                `SELECT to_regclass('${this.table}') as tablename`
            );

            if (!result.rows[0].tablename) {
                await this.pool.query(
                    `CREATE TABLE IF NOT EXISTS ${this.table} (
                        id SERIAL PRIMARY KEY,
                        level VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,
                        meta JSONB,
                        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    )`
                );
            }

            tableInitialized = true;
        } catch (err) {
            console.error(`Failed to check or create table ${this.table}:`, err);
        }
    }

    isActive() {
        return this.pool && !this.pool.ended;
    }

    async close() {
        if (connectionPool) {
            await connectionPool.end();
            connectionPool = null;
            console.log('Closed PostgreSQL connection pool.');
        }
    }
}

module.exports = {
    transport: PostgreSQLTransport,
};