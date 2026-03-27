import { Module } from '@nestjs/common';
import { LocalRulesService, RulesService } from './rules.service';
import { AppConfigRulesProvider } from './app-config-rules.provider';

const isAws = process.env.APP_MODE === 'aws';

/**
 * Provides RulesService (the injection token used throughout the app) backed by:
 *  - LocalRulesService     when APP_MODE=local (default, reads RATE_LIMIT_RULES env)
 *  - AppConfigRulesProvider when APP_MODE=aws  (polls AppConfig sidecar at localhost:2772)
 */
@Module({
  providers: [
    {
      provide: RulesService,
      useClass: isAws ? AppConfigRulesProvider : LocalRulesService,
    },
  ],
  exports: [RulesService],
})
export class RulesModule {}

