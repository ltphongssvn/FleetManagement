// packages/domain/test/ui-affordance.test.ts
// RED-first contract test for the T70 UI AFFORDANCE SSOT.
//
// Why this contract exists (root cause, not symptom): every ops-web screen today
// hand-rolls interactive markup with ad hoc Tailwind classes. There is no shared
// vocabulary for how prominent an action is, why a region is empty, or what help
// a surface offers -- so affordance, disclosure and guidance are re-decided per
// file and are simply ABSENT wherever the author did not think of them. A git
// grep across apps/ops-web/src for Tooltip / EmptyState / aria-describedby /
// onboard returns exactly one hit. Repairing screens one at a time is the
// treadmill; naming the vocabulary once, in the domain, is the source-level fix.
//
// 2026 practice this encodes:
//   - WCAG 2.5.8 Target Size (Minimum), AA: an interactive target is at least
//     24x24 CSS px, or is spaced so a 24px circle centred on it hits nothing
//     else. MIN_TARGET_SIZE_PX is that floor as a contract constant, so a
//     primitive cannot ship a smaller hit area without failing a test.
//   - WCAG 3.2.6 Consistent Help, A: where a help mechanism exists it sits in
//     the same relative position on every page that has one. HELP_TOPICS is the
//     closed set of surfaces that expose one.
//   - WCAG 1.4.1 Use of Colour: tone is a NAMED role, never a raw colour, so a
//     danger action cannot be conveyed by redness alone downstream.
//   - Affordance practice: an empty region must state WHY it is empty and what
//     to do next. EMPTY_STATE_REASONS makes the why enumerable and the Record
//     type makes an unlabelled reason a compile error.
//
// Canonical enum test template (mirrors phieu-can-format.test.ts):
// canonical-values / accepts-each / rejects-unknown+empty / type-narrows,
// PLUS exhaustive Vietnamese label coverage and the target-size floor.
import { describe, expect, it } from 'vitest';
import {
  ACTION_TONES,
  ActionToneSchema,
  type ActionTone,
  ACTION_EMPHASES,
  ActionEmphasisSchema,
  type ActionEmphasis,
  EMPTY_STATE_REASONS,
  EmptyStateReasonSchema,
  type EmptyStateReason,
  EMPTY_STATE_VI,
  HELP_TOPICS,
  HelpTopicSchema,
  type HelpTopic,
  HELP_TOPIC_VI,
  MIN_TARGET_SIZE_PX,
} from '../src/ui/affordance.js';

describe('ACTION_TONES', () => {
  it('is the canonical tone vocabulary, in escalation order', () => {
    expect(ACTION_TONES).toEqual(['neutral', 'primary', 'success', 'warning', 'danger']);
  });

  it('accepts each canonical value', () => {
    for (const v of ACTION_TONES) {
      expect(ActionToneSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(ActionToneSchema.safeParse('destructive').success).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(ActionToneSchema.safeParse('').success).toBe(false);
  });

  it('narrows to the ActionTone type', () => {
    const parsed: ActionTone = ActionToneSchema.parse('danger');
    expect(parsed).toBe('danger');
  });
});

describe('ACTION_EMPHASES', () => {
  // Emphasis is VISUAL WEIGHT and is orthogonal to tone: a danger action can be
  // solid (the confirm button in a destructive dialog) or ghost (a row action).
  // Keeping them separate is what stops a screen inventing a one-off class pair.
  it('is the canonical emphasis vocabulary, heaviest first', () => {
    expect(ACTION_EMPHASES).toEqual(['solid', 'soft', 'ghost']);
  });

  it('accepts each canonical value', () => {
    for (const v of ACTION_EMPHASES) {
      expect(ActionEmphasisSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(ActionEmphasisSchema.safeParse('outline').success).toBe(false);
  });

  it('narrows to the ActionEmphasis type', () => {
    const parsed: ActionEmphasis = ActionEmphasisSchema.parse('ghost');
    expect(parsed).toBe('ghost');
  });
});

describe('EMPTY_STATE_REASONS', () => {
  it('is the canonical why-is-this-empty vocabulary', () => {
    expect(EMPTY_STATE_REASONS).toEqual([
      'no_data_yet',
      'no_search_results',
      'no_filter_results',
      'not_applicable',
      'awaiting_upstream',
    ]);
  });

  it('accepts each canonical value', () => {
    for (const v of EMPTY_STATE_REASONS) {
      expect(EmptyStateReasonSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(EmptyStateReasonSchema.safeParse('empty').success).toBe(false);
  });

  it('narrows to the EmptyStateReason type', () => {
    const parsed: EmptyStateReason = EmptyStateReasonSchema.parse('no_data_yet');
    expect(parsed).toBe('no_data_yet');
  });
});

describe('EMPTY_STATE_VI', () => {
  // The Record<EmptyStateReason, ...> type makes a missing entry a COMPILE error;
  // this test proves it at runtime too, and proves each entry is usable copy
  // rather than a placeholder -- an empty region that says nothing is the defect
  // being fixed, so a blank title or hint must fail here.
  it('labels every reason exhaustively', () => {
    for (const r of EMPTY_STATE_REASONS) {
      expect(Object.keys(EMPTY_STATE_VI)).toContain(r);
    }
    expect(Object.keys(EMPTY_STATE_VI)).toHaveLength(EMPTY_STATE_REASONS.length);
  });

  it('gives every reason a non-empty Vietnamese title and hint', () => {
    for (const r of EMPTY_STATE_REASONS) {
      const entry = EMPTY_STATE_VI[r];
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it('tells a first-time dispatcher what to do when the board has no orders', () => {
    // no_data_yet is the board-empty case in screenshot 1, where the UI today
    // renders a dead-end sentence with no call to action (defect UX-06).
    expect(EMPTY_STATE_VI.no_data_yet.title).toBe('Chưa có lệnh điều xe nào');
    expect(EMPTY_STATE_VI.no_data_yet.hint).toBe('Bấm nút Tạo lệnh điều xe để tạo lệnh đầu tiên.');
  });
});

describe('HELP_TOPICS', () => {
  it('is the canonical set of surfaces that expose a help mechanism', () => {
    expect(HELP_TOPICS).toEqual([
      'dispatch_board',
      'create_order',
      'order_detail',
      'database_admin',
      'driver_assignments',
      'owner_dashboard',
    ]);
  });

  it('accepts each canonical value', () => {
    for (const v of HELP_TOPICS) {
      expect(HelpTopicSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(HelpTopicSchema.safeParse('settings').success).toBe(false);
  });

  it('narrows to the HelpTopic type', () => {
    const parsed: HelpTopic = HelpTopicSchema.parse('dispatch_board');
    expect(parsed).toBe('dispatch_board');
  });
});

describe('HELP_TOPIC_VI', () => {
  it('labels every topic exhaustively', () => {
    for (const topic of HELP_TOPICS) {
      expect(Object.keys(HELP_TOPIC_VI)).toContain(topic);
    }
    expect(Object.keys(HELP_TOPIC_VI)).toHaveLength(HELP_TOPICS.length);
  });

  it('gives every topic a title and at least two concrete steps', () => {
    // Help that is one vague sentence is the same as no help. Two steps is the
    // floor that forces the copy to describe an actual task path.
    for (const topic of HELP_TOPICS) {
      const entry = HELP_TOPIC_VI[topic];
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of entry.steps) {
        expect(step.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('MIN_TARGET_SIZE_PX', () => {
  it('is the WCAG 2.2 SC 2.5.8 Level AA minimum target size', () => {
    expect(MIN_TARGET_SIZE_PX).toBe(24);
  });
});
