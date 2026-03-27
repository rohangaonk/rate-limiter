import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BucketConfig } from '../common/interfaces/bucket-config.interface';
import { IRulesService } from './rules.interface';

/**
 * Local (static) rules provider.
 * Reads rate limit rules once from the RATE_LIMIT_RULES env variable at startup.
 * Used when APP_MODE=local (default).
 */
@Injectable()
export class LocalRulesService implements IRulesService {
  private rules: Map<string, BucketConfig> = new Map();

  constructor(private readonly config: ConfigService) {
    this.loadFromEnv();
  }

  private loadFromEnv(): void {
    const raw = this.config.get<string>('RATE_LIMIT_RULES', '[]');
    try {
      const parsed = JSON.parse(raw) as BucketConfig[];
      for (const rule of parsed) {
        this.rules.set(rule.prefix, rule);
      }
    } catch {
      throw new Error(`Invalid RATE_LIMIT_RULES env value: ${raw}`);
    }
  }

  getRule(prefix: string): BucketConfig | undefined {
    return this.rules.get(prefix);
  }

  getAllRules(): BucketConfig[] {
    return Array.from(this.rules.values());
  }
}

// Re-export under the old name so existing imports keep working during migration
export { LocalRulesService as RulesService };

