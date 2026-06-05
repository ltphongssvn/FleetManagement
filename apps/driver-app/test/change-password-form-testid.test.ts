// apps/driver-app/test/change-password-form-testid.test.ts
// TDD: the driver self-service change-password screen must expose stable testIDs
// on its current-password input, new-password input, and submit button so the
// Maestro flow can target them.
//
// Same automation-contract rationale as login-form-testid.test.ts: on Android RN
// testID sets resource-id for View/Text/Pressable but NOT for TextInput; for
// TextInput the accessibilityLabel is the accessibility id. The testIDs + matching
// accessibilityLabel are the stable contract the Maestro flow relies on (it taps
// inputs/button by their accessibility text: Mật khẩu hiện tại / Mật khẩu mới /
// Lưu mật khẩu). The screen calls the existing PasswordChangeClient (self-service
// POST /driver/me/password); identity is the JWT via useAuth().getAccessToken().
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const screenSrc = readFileSync(resolve(__dirname, '../app/(app)/change-password.tsx'), 'utf8');
const homeSrc = readFileSync(resolve(__dirname, '../app/(app)/index.tsx'), 'utf8');
const Q = String.fromCharCode(34);
describe('driver change-password screen automation testIDs', () => {
  it('current-password input has testID Mật khẩu hiện tại', () => {
    expect(screenSrc.includes('testID=' + Q + 'Mật khẩu hiện tại' + Q)).toBe(true);
  });
  it('new-password input has testID Mật khẩu mới', () => {
    expect(screenSrc.includes('testID=' + Q + 'Mật khẩu mới' + Q)).toBe(true);
  });
  it('submit button has testID Lưu mật khẩu', () => {
    expect(screenSrc.includes('testID=' + Q + 'Lưu mật khẩu' + Q)).toBe(true);
  });
  it('screen wires the existing PasswordChangeClient', () => {
    expect(screenSrc.includes('PasswordChangeClient')).toBe(true);
  });
  it('home screen exposes a Đổi mật khẩu action linking to /change-password', () => {
    expect(homeSrc.includes('Đổi mật khẩu')).toBe(true);
    expect(homeSrc.includes('/change-password')).toBe(true);
  });
});
