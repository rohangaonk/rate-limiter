import { Injectable, Inject, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private luaScript: string;
  private scriptSha: string | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.luaScript = readFileSync(
      join(__dirname, 'token-bucket.lua'),
      'utf-8',
    );
  }

  /**
   * Pre-load the Lua script into Redis and cache its SHA.
   * Called on module init so the first request doesn't pay the load cost.
   */
  async loadScript(): Promise<void> {
    try {
      this.scriptSha = await this.redis.script('LOAD', this.luaScript) as string;
      this.logger.log(`Lua script loaded. SHA: ${this.scriptSha}`);
    } catch (err) {
      this.logger.warn('Could not pre-load Lua script, will use EVAL inline');
    }
  }

  /**
   * Check and update the token bucket for a given key.
   *
   * @param identityKey  e.g. "rl:ip:1.2.3.4" or "rl:apikey:abc123"
   * @param capacity     max tokens in bucket
   * @param refillRate   tokens added per second
   */
  async check(
    identityKey: string,
    capacity: number,
    refillRate: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    try {
      let result: unknown[];
      if (this.scriptSha) {
        try {
          result = (await this.redis.evalsha(
            this.scriptSha,
            1,
            identityKey,
            String(capacity),
            String(refillRate),
            String(now),
          )) as unknown[];
        } catch (err: unknown) {
          if (
            err instanceof Error &&
            err.message.startsWith('NOSCRIPT')
          ) {
            // Script was flushed from Redis, reload and retry once
            await this.loadScript();
            result = (await this.redis.evalsha(
              this.scriptSha!,
              1,
              identityKey,
              String(capacity),
              String(refillRate),
              String(now),
            )) as unknown[];
          } else {
            throw err;
          }
        }
      } else {
        result = (await this.redis.eval(
          this.luaScript,
          1,
          identityKey,
          String(capacity),
          String(refillRate),
          String(now),
        )) as unknown[];
      }

      const [status, remaining, retryAfterMs] = result as [number, number, number];
      return {
        allowed: status === 1,
        remaining: Number(remaining),
        retryAfterMs: Number(retryAfterMs),
      };
    } catch (err) {
      // Redis is unavailable — fail-open (allow request)
      this.logger.error(
        `Redis error for key ${identityKey}, failing open: ${(err as Error).message}`,
      );
      return { allowed: true, remaining: -1, retryAfterMs: 0 };
    }
  }
}
