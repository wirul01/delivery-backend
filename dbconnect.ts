import { createPool } from 'mysql2/promise';

export const conn = createPool({
    connectionLimit: 10,
    host: 'mysql-2f7bf9b2-msu-955b.l.aivencloud.com',
    port: 25989,
    user: 'avnadmin',
    password: 'AVNS_5IcOCanRSOuMTEWxtXh',
    database: 'webadd'
});