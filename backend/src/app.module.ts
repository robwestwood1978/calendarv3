import { Module } from '@nestjs/common';

// Keep your existing AppController
import { AppController } from './app.controller';

// ⬇️ Add these two new controllers (make sure these files exist)
import { HealthController } from './health.controller';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [
    AppController,         // existing
    HealthController,      // new: /api/health
    IntegrationsController // new: /api/fetch-ics?url=...
  ],
  providers: [],
})
export class AppModule {}
