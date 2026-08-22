"use strict";
/**
 * session-identity — pure domain for session identity, keys, and storage
 * partitions.
 *
 * Extracted verbatim from soma `src/core/routing/session-key.ts` (Step 4b,
 * 2026-08-22), minus soma's Telegram delivery policy (`resolveSendFileChatId`)
 * and its scheduler tenant convention (`SCHEDULER_TENANT_ID`) — both stay
 * app-side.
 *
 * Model: a session is identified by a (tenantId, channelId, threadId) triplet
 * of branded, separator-free strings. Two canonical encodings exist —
 * `tenant:channel:thread` (the session key) and `tenant/channel/thread` (the
 * storage partition path) — with symmetric build/parse and invariant errors
 * carrying machine-readable codes.
 *
 * soma-work's current key is `channel-threadTs` (no tenant, different
 * separator, built ad hoc in SessionRegistry). Adopting this identity model
 * there requires migrating persisted session keys — a deliberate future step
 * recorded in the ROADMAP backlog, not smuggled in here.
 *
 * Provenance: soma derives from Fabrizio Rinaldi's MIT claude-telegram-bot —
 * see the attribution note in LICENSE.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionKeyContract = exports.SessionIdentityInvariantError = exports.STORAGE_PARTITION_FORMAT = exports.SESSION_KEY_FORMAT = void 0;
exports.toTenantId = toTenantId;
exports.toChannelId = toChannelId;
exports.toThreadId = toThreadId;
exports.createSessionIdentity = createSessionIdentity;
exports.buildSessionKey = buildSessionKey;
exports.buildSessionKeyFromInput = buildSessionKeyFromInput;
exports.parseSessionKey = parseSessionKey;
exports.buildStoragePartitionKey = buildStoragePartitionKey;
exports.buildStoragePartitionKeyFromInput = buildStoragePartitionKeyFromInput;
exports.parseStoragePartitionKey = parseStoragePartitionKey;
const SESSION_KEY_SEPARATOR = ":";
const STORAGE_PARTITION_SEPARATOR = "/";
const DISALLOWED_IDENTITY_CHARS = /[:/\\]/;
exports.SESSION_KEY_FORMAT = "tenant:channel:thread";
exports.STORAGE_PARTITION_FORMAT = "tenant/channel/thread";
class SessionIdentityInvariantError extends Error {
    constructor(code, field, value) {
        super(`Invalid ${field} (${code}): "${value}"`);
        this.name = "SessionIdentityInvariantError";
        this.code = code;
        this.field = field;
        this.value = value;
    }
}
exports.SessionIdentityInvariantError = SessionIdentityInvariantError;
function validateIdentitySegment(field, rawValue) {
    const normalized = rawValue.trim();
    if (!normalized) {
        throw new SessionIdentityInvariantError("IDENTITY_EMPTY", field, rawValue);
    }
    if (DISALLOWED_IDENTITY_CHARS.test(normalized)) {
        throw new SessionIdentityInvariantError("IDENTITY_CONTAINS_SEPARATOR", field, normalized);
    }
    return normalized;
}
function splitIdentityTriplet(value, separator, code, field) {
    const parts = value.split(separator);
    if (parts.length !== 3) {
        throw new SessionIdentityInvariantError(code, field, value);
    }
    const [tenantId, channelId, threadId] = parts;
    return [tenantId, channelId, threadId];
}
function toTenantId(value) {
    return validateIdentitySegment("tenantId", value);
}
function toChannelId(value) {
    return validateIdentitySegment("channelId", value);
}
function toThreadId(value) {
    return validateIdentitySegment("threadId", value);
}
function createSessionIdentity(input) {
    return {
        tenantId: toTenantId(input.tenantId),
        channelId: toChannelId(input.channelId),
        threadId: toThreadId(input.threadId),
    };
}
function buildSessionKey(identity) {
    return `${identity.tenantId}${SESSION_KEY_SEPARATOR}${identity.channelId}${SESSION_KEY_SEPARATOR}${identity.threadId}`;
}
function buildSessionKeyFromInput(input) {
    return buildSessionKey(createSessionIdentity(input));
}
function parseSessionKey(sessionKey) {
    const [tenantId, channelId, threadId] = splitIdentityTriplet(sessionKey, SESSION_KEY_SEPARATOR, "SESSION_KEY_INVALID_FORMAT", "sessionKey");
    return createSessionIdentity({ tenantId, channelId, threadId });
}
function buildStoragePartitionKey(identity) {
    return `${identity.tenantId}${STORAGE_PARTITION_SEPARATOR}${identity.channelId}${STORAGE_PARTITION_SEPARATOR}${identity.threadId}`;
}
function buildStoragePartitionKeyFromInput(input) {
    return buildStoragePartitionKey(createSessionIdentity(input));
}
function parseStoragePartitionKey(storagePartitionKey) {
    const [tenantId, channelId, threadId] = splitIdentityTriplet(storagePartitionKey, STORAGE_PARTITION_SEPARATOR, "STORAGE_PARTITION_INVALID_FORMAT", "storagePartitionKey");
    return createSessionIdentity({ tenantId, channelId, threadId });
}
exports.sessionKeyContract = {
    createIdentity: createSessionIdentity,
    buildSessionKey,
    parseSessionKey,
    buildStoragePartitionKey,
    parseStoragePartitionKey,
};
