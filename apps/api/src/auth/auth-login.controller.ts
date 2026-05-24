// apps/api/src/auth/auth-login.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthLoginService, type LoginResult } from './auth-login.service.js';

const LoginSchema = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});

@Controller('auth')
export class AuthLoginController {
  constructor(private readonly service: AuthLoginService) {}

  @Post('login')
  async login(@Body() body: z.infer<typeof LoginSchema>): Promise<LoginResult> {
    const parsed = LoginSchema.parse(body);
    return this.service.login(parsed.phone, parsed.password);
  }
}
