import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BucketConfig } from '../common/interfaces/bucket-config.interface';
import { IRulesService } from './rules.interface';

/**
 * Polls the AWS AppConfig agent sidecar (localhost:2772) every POLL_INTERVAL_MS
 * and hot-reloads rate limit rules in memory.
 *
 * The sidecar URL pattern:
 *   http://localhost:2772/applications/<app>/environments/<env>/configurations/<profile>
 *
 * Fail-safe: on fetch/parse error OR empty remote rules, the local fallback snapshot is kept.
 */
@Injectable()
export class AppConfigRulesProvider
  implements IRulesService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AppConfigRulesProvider.name);
  private readonly POLL_INTERVAL_MS = 15_000;

  private rules: Map<string, BucketConfig> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;

  private readonly sidecarUrl: string;

  constructor(private readonly config: ConfigService) {
    const app = this.config.get<string>('APPCONFIG_APP', 'rate-limiter');
    const env = this.config.get<string>('APPCONFIG_ENV', 'production');
    const profile = this.config.get<string>('APPCONFIG_PROFILE', 'rules');

    this.sidecarUrl = `http://localhost:2772/applications/${app}/environments/${env}/configurations/${profile}`;

    // Load local defaults from environment so we are not empty if AppConfig is slow/down
    this.loadLocalDefaults();
  }

  private loadLocalDefaults(): void {
    const raw = this.config.get<string>('RATE_LIMIT_RULES', '[]');
    try {
      const parsed = JSON.parse(raw) as BucketConfig[];
      for (const rule of parsed) {
        this.rules.set(rule.prefix, rule);
      }
      this.logger.log(`Initialized with ${this.rules.size} local fallback rules`);
    } catch {
      this.logger.warn('Failed to parse local RATE_LIMIT_RULES fallback');
    }
  }

  async onModuleInit(): Promise<void> {
    // Fetch immediately on startup so rules are populated before first request
    await this.fetchAndUpdate();

    this.pollTimer = setInterval(() => {
      void this.fetchAndUpdate();
    }, this.POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  private async fetchAndUpdate(): Promise<void> {
    try {
      const response = await fetch(this.sidecarUrl);

      if (!response.ok) {
        this.logger.warn(
          `AppConfig sidecar returned ${response.status} — keeping previous rules`,
        );
        return;
      }

      const text = await response.text();

      // AppConfig returns an empty body when config has not changed since last poll
      if (!text || text.trim() === '') {
        return;
      }

      const parsed = JSON.parse(text) as BucketConfig[];

      // Guard: if remote returns an empty array, treat it as a misconfiguration
      // and fall back to local defaults rather than going fail-open.
      if (parsed.length === 0) {
        this.logger.warn('AppConfig returned empty rules — keeping local fallback rules');
        this.loadLocalDefaults();
        return;
      }

      const updated = new Map<string, BucketConfig>();
      for (const rule of parsed) {
        updated.set(rule.prefix, rule);
      }

      this.rules = updated;
      this.logger.log(
        `Rules updated from AppConfig — ${updated.size} rule(s) loaded`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch rules from AppConfig sidecar: ${(err as Error).message} — keeping previous rules`,
      );
    }
  }

  getRule(prefix: string): BucketConfig | undefined {
    return this.rules.get(prefix);
  }

  getAllRules(): BucketConfig[] {
    return Array.from(this.rules.values());
  }
}
