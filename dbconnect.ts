import { createPool } from 'mysql2/promise';

export const conn = createPool({
    connectionLimit: 10,
    host: 'web-delivery-msu-955b.b.aivencloud.com',
    port: 25989,
    user: 'avnadmin',
    password: 'AVNS_IRPtT4Nu0DP-wRECDj5',
    database: 'delivery'
});