export interface OidcLoginTransactionRecord {
  nonce: string;
  pkceVerifier: string;
  redirectUri: string;
  returnPath: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateOidcLoginTransactionInput extends OidcLoginTransactionRecord {
  state: string;
}

export type ConsumeOidcLoginTransactionResult =
  | { outcome: 'consumed'; transaction: OidcLoginTransactionRecord }
  | { outcome: 'missing' | 'expired' | 'replayed' };

export interface OidcLoginTransactionPort {
  create(input: CreateOidcLoginTransactionInput): Promise<void>;
  consume(state: string, now: Date): Promise<ConsumeOidcLoginTransactionResult>;
  cleanupTransactions(now: Date, limit: number): Promise<number>;
}
