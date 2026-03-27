import { Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimiterGuard } from './rate-limiter.guard';
import { RulesModule } from '../rules/rules.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [RulesModule, IdentityModule],
  providers: [RateLimiterService, RateLimiterGuard],
  exports: [RateLimiterService, RateLimiterGuard],
})
export class RateLimiterModule {}
