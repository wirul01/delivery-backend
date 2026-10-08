import { createPool } from 'mysql2/promise';

export const conn = createPool({
    connectionLimit: 10,
    host: 'mysql-27075959-msu-dd8c.l.aivencloud.com',
    port: 21322,
    user: 'avnadmin',
    password: process.env.DB_PASSWORD!,
    database: 'defaultdb'
});

