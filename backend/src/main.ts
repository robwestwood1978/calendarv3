import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Allow your exact frontend origin(s) and credentials
  const origins = (process.env.FRONTEND_ORIGIN || '').split(',')
    .map(s => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length ? origins : false, // disable wildcard
    credentials: true,
  });

  const port = process.env.PORT || 8080;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
}
bootstrap();
