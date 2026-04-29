// Shared module code mappings
// Used for generating CMS-compliant filenames.
//
// Carl is the source of truth for module acronyms (Module.acronym). When a
// Carl push includes moduleAcronym in the payload, callers should forward it
// as acronymOverride and skip the map. The map remains as a fallback for
// payloads that don't carry the acronym (older callers, third parties).

const MODULE_CODE_MAP = {
  'Reactions': 'REAC',
  'Energy': 'ENER',
  'Waves': 'WAVE',
  'Forces': 'FORC',
  'Matter': 'MATT',
  'Ecosystems': 'ECOS',
  'Heat and Energy': 'HEAT'
};

/**
 * Get the module code for a given module name.
 * @param {string} moduleName - The module name
 * @param {string} [acronymOverride] - Acronym sent by Carl (Module.acronym).
 *   Used directly when present so we don't have to keep the map in sync.
 * @returns {string} The 4-character module code
 */
function getModuleCode(moduleName, acronymOverride) {
  if (acronymOverride) return acronymOverride;
  return MODULE_CODE_MAP[moduleName] || moduleName.substring(0, 4).toUpperCase();
}

module.exports = {
  MODULE_CODE_MAP,
  getModuleCode
};
