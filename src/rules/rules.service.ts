import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BucketConfig } from '../common/interfaces/bucket-config.interface';

@Injectable()
export class RulesService {
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
