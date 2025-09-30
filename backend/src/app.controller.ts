import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('/health')
  health() {
    return { ok: true, service: 'family-calendar-backend', version: '0.1.0' };
  }

  @Get('/events')
  getEvents() {
    // placeholder data — we will replace with DB + CalDAV sync in later slices
    return {
      events: [
        { id: 'e1', title: 'School drop-off', start: new Date().toISOString() },
        { id: 'e2', title: 'Football training', start: new Date(Date.now() + 3600_000).toISOString() }
      ]
    };
  }
}
