import { SETUP_KEYS, validSetupPatch, type SetupPatch, type SetupSettings } from '@workspace/safesight-guide';

/** Reject stale proposals instead of overwriting edits made in Settings/another tab. */
export function proposalConflicts(current: SetupSettings, baseline: SetupSettings, patch: SetupPatch): boolean {
  return !validSetupPatch(patch) || SETUP_KEYS.some(key => Object.hasOwn(patch, key) && current[key] !== baseline[key]);
}
export function changedValues(current: SetupSettings, patch: SetupPatch): SetupPatch {
  return Object.fromEntries(SETUP_KEYS.filter(key => Object.hasOwn(patch, key) && current[key] !== patch[key])
    .map(key => [key, patch[key]])) as SetupPatch;
}
export function previousValues(current: SetupSettings, patch: SetupPatch): SetupPatch {
  return Object.fromEntries(SETUP_KEYS.filter(key => Object.hasOwn(patch, key)).map(key => [key, current[key]])) as SetupPatch;
}
