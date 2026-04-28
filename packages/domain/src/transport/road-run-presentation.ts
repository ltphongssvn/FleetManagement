// packages/domain/src/transport/road-run-presentation.ts
// Tailwind utility classes per road run state. Single source of truth shared
// between ops-web (dispatch board) and driver-app (run cards).
import type { RoadRunState } from './road-run-state.js';

export const ROAD_RUN_STATE_TONE: Readonly<Record<RoadRunState, string>> = Object.freeze({
  planned: 'bg-slate-100 text-slate-700',
  dispatched: 'bg-amber-100 text-amber-800',
  started: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-700',
});
