import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RateLimiterService } from './rate-limiter/rate-limiter.service';
import { REDIS_CLIENT } from './redis/redis.module';
import Redis from 'ioredis';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Pre-load Lua script if Redis is already up, or let it happen on first request
  try {
    const rateLimiter = app.get(RateLimiterService);
    await rateLimiter.loadScript();
  } catch (err) {
    console.warn('[Bootstrap] Could not pre-load Lua script, will retry on first request:', err.message);
  }

  const port = process.env.PORT ?? 3000;
  // Listen on 0.0.0.0 for ECS networking
  await app.listen(port, '0.0.0.0');
  
  console.log(`[Bootstrap] Rate limiter is UP and listening on http://0.0.0.0:${port}`);
  console.log(`[Bootstrap] Health check endpoint: http://0.0.0.0:${port}/health`);
}
bootstrap();
