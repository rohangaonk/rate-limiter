import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimiterService } from './rate-limiter.service';
import { RulesService } from '../rules/rules.service';
import { IdentityService } from '../identity/identity.service';

export const SKIP_RATE_LIMIT = 'skipRateLimit';
/** Decorator to bypass rate limiting on a specific route */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);

  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly rules: RulesService,
    private readonly identity: IdentityService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check @SkipRateLimit() decorator
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { keys, label } = this.identity.extract(req);

    // Check each identity layer — all must pass
    for (const key of keys) {
      // Determine which rule applies based on the key prefix (e.g. "rl:ip:...")
      const prefix = key.split(':')[1]; // "ip", "user", "apikey"
      const rule = this.rules.getRule(prefix);

      if (!rule) {
        // No rule configured for this layer — skip it
        continue;
      }

      const result = await this.rateLimiter.check(
        key,
        rule.capacity,
        rule.refillRate,
      );

      // Attach the most restrictive remaining count to response headers
      res.setHeader('X-RateLimit-Limit', rule.capacity);
      res.setHeader('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader('Retry-After', retryAfterSec);

        this.logger.warn(
          `Rate limit exceeded — identity: ${label}, layer: ${prefix}, retryAfter: ${retryAfterSec}s`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
            retryAfter: retryAfterSec,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
