import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from './redis/redis.module';
import { RateLimiterModule } from './rate-limiter/rate-limiter.module';
import { RulesModule } from './rules/rules.module';
import { IdentityModule } from './identity/identity.module';
import { RateLimiterGuard } from './rate-limiter/rate-limiter.guard';
import { ResourceController } from './resource/resource.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    RulesModule,
    IdentityModule,
    RateLimiterModule,
  ],
  controllers: [AppController, ResourceController],
  providers: [
    AppService,
    {
      // APP_GUARD resolves dependencies from AppModule scope
      provide: APP_GUARD,
      useClass: RateLimiterGuard,
    },
  ],
})
export class AppModule {}
