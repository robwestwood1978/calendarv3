import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import fetch from 'node-fetch';

function allowlist(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host.endsWith('icloud.com') ||
      host.endsWith('apple.com') ||
      host.endsWith('calendar.google.com') ||
      host.endsWith('googleusercontent.com') ||
      host.endsWith('google.com')
    );
  } catch {
    return false;
  }
}

@Controller('/api')
export class IntegrationsController {
  @Get('/fetch-ics')
  async fetchICS(@Query('url') url: string, @Res() res: Response) {
    if (!url || !allowlist(url)) return res.status(400).send('Invalid or disallowed ICS URL');
    try {
      const httpUrl = url.replace(/^webcal:/i, 'https:');
      const r = await fetch(httpUrl as any, { redirect: 'follow' as any });
      if (!r.ok) return res.status(r.status).send('Upstream ICS fetch failed');
      const text = await r.text();
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(text);
    } catch {
      return res.status(500).send('ICS proxy error');
    }
  }
}
