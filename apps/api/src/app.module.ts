// apps/api/src/app.module.ts
// Root NestJS module. Sub-modules (Auth, Device, Dispatch, RoadOps, etc.)
// will be registered here as they are scaffolded per Frozen Stack PDF.
import { Controller, Get, Module } from '@nestjs/common';

// Health controller — minimal endpoint so AppModule is non-empty and lintable.
// Real controllers/services arrive in week 3+ per day-one plan.
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

// NestJS module classes are intentionally empty — decorator carries the metadata.
// Disabling no-extraneous-class is the framework-idiomatic exception.
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
