import { BucketConfig } from '../common/interfaces/bucket-config.interface';

export interface IRulesService {
  getRule(prefix: string): BucketConfig | undefined;
  getAllRules(): BucketConfig[];
}

export const RULES_SERVICE = Symbol('RULES_SERVICE');
