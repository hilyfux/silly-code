// Leaf config module — intentionally minimal imports so UI components
// can read the auto-dream enabled state without dragging in the forked
// agent / task registry / message builder chain that autoDream.ts pulls in.

import { getInitialSettings } from '../../utils/settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * Whether background memory consolidation should run.
 *
 * Silly Code: default ON. GrowthBook is disabled in our build, so the
 * upstream fallback (tengu_onyx_plover) always returned false. We flip
 * the default to true — consolidation is a core memory quality feature,
 * not an experiment. User can still disable via autoDreamEnabled: false
 * in settings.json.
 */
export function isAutoDreamEnabled(): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting
  // Silly Code: default true (upstream defaulted to GrowthBook which was false)
  return true
}
