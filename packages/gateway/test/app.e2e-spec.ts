import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Gateway e2e', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => res.body.status === 1);
  });
  it('/:connect (POST)', () => {
    // mocking not shown: assume shardService.Connect is stubbed via test setup
    return request(app.getHttpServer())
      .post('/connect')
      .send({ phoneNumber: '+972501234567', clientType: 'full' })
      .expect(201);
  });
});