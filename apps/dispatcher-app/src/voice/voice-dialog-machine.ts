// apps/dispatcher-app/src/voice/voice-dialog-machine.ts
// Voice-dispatch dialog FSM (T17), xstate v5. Pure orchestration logic:
// STT results, planner responses and TTS completion arrive as EVENTS from
// thin adapters, so this machine owns the conversation flow and the ONE
// business-critical safety invariant -- Tao lenh is TAP-ONLY. reviewing
// declares no transition for any voice event; only TAP_TAO_LENH enters
// submitting, so the dispatcher consciously sends every order. The plan
// held in context is the untouched CopilotPlan from /copilot/plan; the
// submit adapter forwards it verbatim to /copilot/execute (planId stays
// the idempotency key).
import { assign, setup } from 'xstate';
import type { CopilotPlan } from '@fleet/sync-protocol';
export interface VoiceDialogContext {
  transcript: string | null;
  plan: CopilotPlan | null;
  questionVi: string | null;
  errorVi: string | null;
}
export type VoiceDialogEvent =
  | { type: 'START_LISTENING' }
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'STT_ERROR'; messageVi: string }
  | { type: 'PLAN_OK'; plan: CopilotPlan }
  | { type: 'PLAN_CLARIFY'; questionVi: string }
  | { type: 'PLAN_ERROR'; messageVi: string }
  | { type: 'TTS_DONE' }
  | { type: 'VOICE_CONFIRM' }
  | { type: 'TAP_TAO_LENH' }
  | { type: 'TAP_CANCEL' }
  | { type: 'SUBMIT_OK' }
  | { type: 'SUBMIT_ERROR'; messageVi: string };
const initialContext: VoiceDialogContext = {
  transcript: null,
  plan: null,
  questionVi: null,
  errorVi: null,
};
export const voiceDialogMachine = setup({
  types: {
    context: {} as VoiceDialogContext,
    events: {} as VoiceDialogEvent,
  },
}).createMachine({
  id: 'voiceDialog',
  context: initialContext,
  initial: 'idle',
  states: {
    idle: {
      entry: assign(() => initialContext),
      on: { START_LISTENING: 'listening' },
    },
    listening: {
      on: {
        TRANSCRIPT: {
          target: 'planning',
          actions: assign({ transcript: ({ event }) => event.text }),
        },
        STT_ERROR: {
          target: 'idle',
          actions: assign({ errorVi: ({ event }) => event.messageVi }),
        },
        TAP_CANCEL: 'idle',
      },
    },
    planning: {
      on: {
        PLAN_OK: {
          target: 'speakingSummary',
          actions: assign({ plan: ({ event }) => event.plan, questionVi: () => null }),
        },
        PLAN_CLARIFY: {
          target: 'clarifying',
          actions: assign({ questionVi: ({ event }) => event.questionVi, plan: () => null }),
        },
        PLAN_ERROR: {
          target: 'idle',
          actions: assign({ errorVi: ({ event }) => event.messageVi }),
        },
        TAP_CANCEL: 'idle',
      },
    },
    speakingSummary: {
      on: {
        TTS_DONE: 'reviewing',
        TAP_CANCEL: 'idle',
      },
    },
    clarifying: {
      on: {
        TTS_DONE: 'listening',
        TAP_CANCEL: 'idle',
      },
    },
    // THE invariant: no voice event is wired here. VOICE_CONFIRM and
    // TRANSCRIPT fall through as no-ops; only the physical tap advances.
    reviewing: {
      on: {
        TAP_TAO_LENH: 'submitting',
        TAP_CANCEL: 'idle',
      },
    },
    submitting: {
      on: {
        SUBMIT_OK: 'done',
        SUBMIT_ERROR: {
          target: 'reviewing',
          actions: assign({ errorVi: ({ event }) => event.messageVi }),
        },
      },
    },
    done: {
      on: { START_LISTENING: 'listening' },
    },
  },
});
