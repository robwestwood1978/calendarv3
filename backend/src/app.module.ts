import { Module } from '@nestjs/common';

// Keep your existing controller(s)
import { AppController } from './app.controller';

// Add these two small controllers
import { HealthController } from './health.controller';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [
    AppController,         // existing
    HealthController,      // new: GET /api/health
    IntegrationsController // new: GET /api/fetch-ics?url=...
  ],
  providers: [],
})
export class AppModule {}
