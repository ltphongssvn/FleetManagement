// apps/driver-app/test/login-form-testid.test.ts
// TDD: the driver login screen must expose stable testIDs on its phone input,
// password input, and submit button so the Maestro flow can target them.
//
// On Android, RN testID sets resource-id for View/Text/Pressable but NOT for
// TextInput; for TextInput, accessibilityLabel is the accessibility id. These
// testIDs (plus the matching accessibilityLabel) are the stable automation
// contract the Maestro flow relies on (it targets the inputs/button by their
// accessibility text). Maestro React Native guidance recommends testID.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const loginSrc = readFileSync(resolve(__dirname, '../app/(auth)/login.tsx'), 'utf8');
const Q = String.fromCharCode(34);
describe('driver login screen automation testIDs', () => {
  it('phone input has testID Số điện thoại', () => {
    expect(loginSrc.includes('testID=' + Q + 'Số điện thoại' + Q)).toBe(true);
  });
  it('password input has testID Mật khẩu', () => {
    expect(loginSrc.includes('testID=' + Q + 'Mật khẩu' + Q)).toBe(true);
  });
  it('submit button has testID Đăng nhập', () => {
    expect(loginSrc.includes('testID=' + Q + 'Đăng nhập' + Q)).toBe(true);
  });
});
