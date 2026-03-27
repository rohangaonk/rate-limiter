export interface BucketConfig {
  /** Identity prefix this rule applies to: 'ip' | 'user' | 'apikey' */
  prefix: string;
  /** Maximum tokens in the bucket */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
}
