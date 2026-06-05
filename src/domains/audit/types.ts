// ===========================================================================
// Audit Domain — Types
//
// Domain-level type definitions for audit events.
// ===========================================================================

import type { JsonValue } from '@/lib/types';
import type { UserDisplayInfo } from '@/domains/identity/types';

/** Allowed audit actor type values */
export const AUDIT_ACTOR_TYPE_VALUES = [
  'USER',
  'SYSTEM',
  'AI_RECEPTIONIST',
] as const;

/** Allowed audit result values */
export const AUDIT_RESULT_VALUES = ['SUCCESS', 'DENIED', 'FAILED'] as const;

/** Audit actor type */
export type AuditActorTypeValue = (typeof AUDIT_ACTOR_TYPE_VALUES)[number];

/** Audit result */
export type AuditResultValue = (typeof AUDIT_RESULT_VALUES)[number];

/** Domain representation of an audit event */
export interface AuditEventIdentity {
  id: string;
  businessId: string | null;
  actorType: AuditActorTypeValue;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: AuditResultValue;
  metadata: JsonValue | null;
  createdAt: string;
  /** Resolved actor user display info (present when loaded via list query) */
  actorUser?: UserDisplayInfo;
}

/** Input for creating an audit event */
export interface CreateAuditEventInput {
  businessId?: string;
  actorType: AuditActorTypeValue;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: AuditResultValue;
  metadata?: JsonValue;
}
