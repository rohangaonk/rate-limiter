import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface IdentityKeys {
  /** All identity keys derived from the request (in priority order) */
  keys: string[];
  /** Primary identity label for logging */
  label: string;
}

@Injectable()
export class IdentityService {
  /**
   * Extracts all applicable identity keys from a request.
   * Each key corresponds to one rate-limit layer.
   *
   * Order of priority (highest first):
   *  1. X-API-Key header   → "apikey:<value>"
   *  2. X-User-Id header   → "user:<value>"
   *     (in prod this would be parsed from a validated JWT sub claim)
   *  3. IP address         → "ip:<addr>"      (always present as fallback)
   */
  extract(req: Request): IdentityKeys {
    const keys: string[] = [];

    const apiKey = req.headers['x-api-key'] as string | undefined;
    const userId = req.headers['x-user-id'] as string | undefined;
    const ip = this.resolveIp(req);

    if (apiKey) {
      keys.push(`rl:apikey:${apiKey}`);
    }

    if (userId) {
      keys.push(`rl:user:${userId}`);
    }

    // IP is always added — even API-key requests are IP-bounded
    keys.push(`rl:ip:${ip}`);

    const label = apiKey
      ? `apikey:${apiKey}`
      : userId
        ? `user:${userId}`
        : `ip:${ip}`;

    return { keys, label };
  }

  /**
   * Resolves the real client IP, respecting X-Forwarded-For
   * (set by a trusted reverse proxy / load balancer).
   */
  private resolveIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    if (forwarded) {
      // X-Forwarded-For: <client>, <proxy1>, <proxy2>
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? '0.0.0.0';
  }
}
