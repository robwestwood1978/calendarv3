import { Controller, Get } from '@nestjs/common';

@Controller('/api')
export class HealthController {
  @Get('/health')
  ok() {
    return { ok: true, t: Date.now() };
  }
}
