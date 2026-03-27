import { Controller, Get } from '@nestjs/common';
import { SkipRateLimit } from '../rate-limiter/rate-limiter.guard';

/**
 * Mock resource controller — demonstrates rate limiting in action.
 * In a real gateway this would proxy to an upstream service.
 */
@Controller('resource')
export class ResourceController {
  /** Public endpoint — no rate limit */
  @SkipRateLimit()
  @Get('public')
  getPublic() {
    return { message: 'Public endpoint — no rate limit applied.' };
  }

  /** Standard protected endpoint */
  @Get('data')
  getData() {
    return { message: 'Data fetched successfully.', timestamp: Date.now() };
  }

  /** Another protected endpoint (higher-tier rule applies via apikey layer) */
  @Get('premium')
  getPremium() {
    return { message: 'Premium data fetched.', timestamp: Date.now() };
  }
}
