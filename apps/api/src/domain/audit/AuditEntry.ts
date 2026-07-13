export class AuditEntry {
  private constructor(
    readonly id: string,
    readonly skillId: string | null,
    readonly skillVersion: string | null,
    readonly proposalId: string | null,
    readonly action: string,
    readonly actor: string,
    readonly before: Record<string, unknown> | null,
    readonly after: Record<string, unknown> | null,
    readonly createdAt: Date
  ) {}

  static create(props: {
    id?: string;
    skillId?: string | null;
    skillVersion?: string | null;
    proposalId?: string | null;
    action: string;
    actor: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    createdAt?: Date;
  }): AuditEntry {
    return new AuditEntry(
      props.id ?? generateAuditId(),
      props.skillId ?? null,
      props.skillVersion ?? null,
      props.proposalId ?? null,
      props.action,
      props.actor,
      props.before ?? null,
      props.after ?? null,
      props.createdAt ?? new Date()
    );
  }
}

function generateAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
