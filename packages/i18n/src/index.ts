// packages/i18n/src/index.ts
// Public surface of the message SSOT. Re-export only: the vitest config
// excludes **/index.ts from coverage by convention (mirroring
// @fleet/design-tokens), so logic here would be untested by construction.
export {
  LOCALES,
  LocaleSchema,
  DEFAULT_LOCALE,
  parseLocale,
  VI,
  EN,
  t,
} from './messages.js';
export type { Locale, MessageKey } from './messages.js';
