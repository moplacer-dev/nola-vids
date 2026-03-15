// Shared module code mappings
// Used for generating CMS-compliant filenames

const MODULE_CODE_MAP = {
  'Reactions': 'REAC',
  'Energy': 'ENER',
  'Waves': 'WAVE',
  'Forces': 'FORC',
  'Matter': 'MATT',
  'Ecosystems': 'ECOS',
  'Heat and Energy': 'ENER'
};

/**
 * Get the module code for a given module name
 * @param {string} moduleName - The module name
 * @returns {string} The 4-character module code
 */
function getModuleCode(moduleName) {
  return MODULE_CODE_MAP[moduleName] || moduleName.substring(0, 4).toUpperCase();
}

module.exports = {
  MODULE_CODE_MAP,
  getModuleCode
};
