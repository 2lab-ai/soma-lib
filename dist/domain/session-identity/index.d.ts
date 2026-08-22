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
export declare const SESSION_KEY_FORMAT = "tenant:channel:thread";
export declare const STORAGE_PARTITION_FORMAT = "tenant/channel/thread";
declare const tenantIdBrand: unique symbol;
declare const channelIdBrand: unique symbol;
declare const threadIdBrand: unique symbol;
declare const sessionKeyBrand: unique symbol;
declare const storagePartitionKeyBrand: unique symbol;
export type TenantId = string & {
    readonly [tenantIdBrand]: "TenantId";
};
export type ChannelId = string & {
    readonly [channelIdBrand]: "ChannelId";
};
export type ThreadId = string & {
    readonly [threadIdBrand]: "ThreadId";
};
export type SessionKey = string & {
    readonly [sessionKeyBrand]: "SessionKey";
};
export type StoragePartitionKey = string & {
    readonly [storagePartitionKeyBrand]: "StoragePartitionKey";
};
export interface SessionIdentityInput {
    tenantId: string;
    channelId: string;
    threadId: string;
}
export interface SessionIdentity {
    tenantId: TenantId;
    channelId: ChannelId;
    threadId: ThreadId;
}
export type SessionIdentityField = keyof SessionIdentityInput;
type SessionIdentityContractField = SessionIdentityField | "sessionKey" | "storagePartitionKey";
export type SessionIdentityInvariantCode = "IDENTITY_EMPTY" | "IDENTITY_CONTAINS_SEPARATOR" | "SESSION_KEY_INVALID_FORMAT" | "STORAGE_PARTITION_INVALID_FORMAT";
export declare class SessionIdentityInvariantError extends Error {
    readonly code: SessionIdentityInvariantCode;
    readonly field: SessionIdentityContractField;
    readonly value: string;
    constructor(code: SessionIdentityInvariantCode, field: SessionIdentityContractField, value: string);
}
export declare function toTenantId(value: string): TenantId;
export declare function toChannelId(value: string): ChannelId;
export declare function toThreadId(value: string): ThreadId;
export declare function createSessionIdentity(input: SessionIdentityInput): SessionIdentity;
export declare function buildSessionKey(identity: SessionIdentity): SessionKey;
export declare function buildSessionKeyFromInput(input: SessionIdentityInput): SessionKey;
export declare function parseSessionKey(sessionKey: string): SessionIdentity;
export declare function buildStoragePartitionKey(identity: SessionIdentity): StoragePartitionKey;
export declare function buildStoragePartitionKeyFromInput(input: SessionIdentityInput): StoragePartitionKey;
export declare function parseStoragePartitionKey(storagePartitionKey: string): SessionIdentity;
export interface SessionKeyContract {
    createIdentity(input: SessionIdentityInput): SessionIdentity;
    buildSessionKey(identity: SessionIdentity): SessionKey;
    parseSessionKey(sessionKey: string): SessionIdentity;
    buildStoragePartitionKey(identity: SessionIdentity): StoragePartitionKey;
    parseStoragePartitionKey(storagePartitionKey: string): SessionIdentity;
}
export declare const sessionKeyContract: SessionKeyContract;
export {};
