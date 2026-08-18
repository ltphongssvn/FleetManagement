// packages/domain/test/ui-affordance.barrel-export.test.ts
// Contract test: the T70 affordance vocabulary MUST be reachable from the
// package ROOT (@fleet/domain), not only from a deep src path.
//
// Why this is a test and not a convention: a deep import such as
// @fleet/domain/src/ui/affordance.js is exactly what invites a consumer to give
// up and re-declare its own tone/emphasis union locally -- which is the
// duplication this whole arc exists to remove. The barrel is the seam that
// makes the SSOT the path of least resistance for ops-web, driver-app and
// owner-app alike, so it is asserted rather than assumed.
//
// Mirrors packages/domain/test/phieu-can-format.barrel-export.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ACTION_TONES,
  ActionToneSchema,
  ACTION_EMPHASES,
  ActionEmphasisSchema,
  EMPTY_STATE_REASONS,
  EmptyStateReasonSchema,
  EMPTY_STATE_VI,
  HELP_TOPICS,
  HelpTopicSchema,
  HELP_TOPIC_VI,
  MIN_TARGET_SIZE_PX,
} from '../src/index.js';

describe('@fleet/domain barrel: UI affordance vocabulary', () => {
  it('re-exports the tone vocabulary and its schema', () => {
    expect(ACTION_TONES).toEqual(['neutral', 'primary', 'success', 'warning', 'danger']);
    expect(ActionToneSchema.parse('primary')).toBe('primary');
  });

  it('re-exports the emphasis vocabulary and its schema', () => {
    expect(ACTION_EMPHASES).toEqual(['solid', 'soft', 'ghost']);
    expect(ActionEmphasisSchema.parse('soft')).toBe('soft');
  });

  it('re-exports the empty-state vocabulary, schema and Vietnamese copy', () => {
    expect(EMPTY_STATE_REASONS).toContain('no_data_yet');
    expect(EmptyStateReasonSchema.parse('not_applicable')).toBe('not_applicable');
    expect(Object.keys(EMPTY_STATE_VI)).toHaveLength(EMPTY_STATE_REASONS.length);
  });

  it('re-exports the help vocabulary, schema and Vietnamese copy', () => {
    expect(HELP_TOPICS).toContain('dispatch_board');
    expect(HelpTopicSchema.parse('create_order')).toBe('create_order');
    expect(Object.keys(HELP_TOPIC_VI)).toHaveLength(HELP_TOPICS.length);
  });

  it('re-exports the WCAG 2.5.8 minimum target size', () => {
    expect(MIN_TARGET_SIZE_PX).toBe(24);
  });
});
