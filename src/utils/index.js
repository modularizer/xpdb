"use strict";
/**
 * xp-deeby Utilities
 *
 * Re-exports utility functions from various modules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUUID = exports.runMigrations = exports.deleteMissingChildren = void 0;
exports.applyQueryModifiers = applyQueryModifiers;
exports.upsertEntity = upsertEntity;
exports.upsertEntities = upsertEntities;
exports.makeIdempotent = makeIdempotent;
exports.convertToPostgres = convertToPostgres;
exports.convertBackticksToQuotes = convertBackticksToQuotes;
exports.hashSQL = hashSQL;
// Export from upsert.ts
var upsert_1 = require("./upsert");
Object.defineProperty(exports, "deleteMissingChildren", { enumerable: true, get: function () { return upsert_1.deleteMissingChildren; } });
// Export from migrations.ts
var migrations_1 = require("./migrations");
Object.defineProperty(exports, "runMigrations", { enumerable: true, get: function () { return migrations_1.runMigrations; } });
// Export from xp-schema
var xp_schema_1 = require("../xp-schema");
Object.defineProperty(exports, "generateUUID", { enumerable: true, get: function () { return xp_schema_1.generateUUID; } });
// Stub implementations for missing utilities
// TODO: Implement these properly
function applyQueryModifiers(query, state) {
    // Stub implementation - needs to be implemented
    return query;
}
async function upsertEntity(db, table, entity, condition) {
    // Stub implementation - use db.upsertWhere instead
    throw new Error('upsertEntity is not implemented. Use db.upsertWhere() instead.');
}
async function upsertEntities(db, table, entities, condition) {
    // Stub implementation - use db.upsertWhere with array instead
    throw new Error('upsertEntities is not implemented. Use db.upsertWhere() with an array instead.');
}
// SQL utility functions (to be implemented or found)
function makeIdempotent(sql) {
    // Stub - needs implementation
    return sql;
}
function convertToPostgres(sql) {
    // Stub - needs implementation
    return sql;
}
function convertBackticksToQuotes(sql) {
    // Stub - needs implementation
    return sql.replace(/`/g, '"');
}
function hashSQL(sql) {
    // Stub - needs implementation
    // Simple hash for now
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
        const char = sql.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}
//# sourceMappingURL=index.js.map