import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { SkipRateLimit } from './rate-limiter/rate-limiter.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @SkipRateLimit()
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
