import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RateLimiterService } from './rate-limiter/rate-limiter.service';
import { REDIS_CLIENT } from './redis/redis.module';
import Redis from 'ioredis';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Explicitly connect Redis (lazyConnect=true means it waits otherwise)
  const redis = app.get<Redis>(REDIS_CLIENT);
  await redis.connect();

  // Pre-load Lua script SHA into Redis
  const rateLimiter = app.get(RateLimiterService);
  await rateLimiter.loadScript();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Rate limiter running on http://localhost:${port}`);
}
bootstrap();
