import { useState } from 'react';

// Canonical-11 media types (v2). Legacy v1 records render via the fallback option below.
const MEDIA_TYPES = [
  { value: 'diagram',             label: 'Diagram' },
  { value: 'realistic_photo',     label: 'Realistic Photo' },
  { value: 'career_video',        label: 'Career Video' },
  { value: 'intro_video',         label: 'Intro Video' },
  { value: 'procedure_video',     label: 'Procedure Video' },
  { value: 'screen_recording',    label: 'Screen Recording' },
  { value: 'data_graph',          label: 'Data Graph' },
  { value: 'data_table',          label: 'Data Table' },
  { value: 'interactive_element', label: 'Interactive Element' },
  { value: 'default_template',    label: 'Default Template' },
  { value: 'reused_asset',        label: 'Reused Asset' },
];

export default function PromptEditor({ image, onSave, onClose, mode = 'edit', showAssetTypeSelector = false }) {
  const isAddMode = mode === 'add';
  const [prompt, setPrompt] = useState(
    isAddMode ? '' : (image.modifiedPrompt || image.originalPrompt || '')
  );
  const [assetType, setAssetType] = useState(
    isAddMode ? (image.assetType || 'ai_generated_image') : (image.assetType || '')
  );

  const hasRecord = isAddMode || !!image.id;

  // Check if asset type changed
  const assetTypeChanged = assetType !== (image.assetType || '');

  const handleSave = () => {
    if (isAddMode) {
      // In add mode, pass the prompt and asset type to create a new asset
      onSave(image.id, prompt, assetType);
    } else if (hasRecord) {
      onSave(image.id, prompt, assetTypeChanged ? assetType : undefined);
    } else {
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="prompt-editor-overlay" onClick={onClose}>
      <div
        className="prompt-editor"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="prompt-editor-header">
          <h3>
            {isAddMode ? 'Add Asset' : 'Edit Prompt'} - Slide {image.slideNumber}
            {!isAddMode && image.assetType && <span className="prompt-asset-type"> ({image.assetType.replace(/_/g, ' ')}{image.assetNumber > 1 ? ` #${image.assetNumber}` : ''})</span>}
          </h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {!hasRecord && !isAddMode && (
          <div className="prompt-editor-warning">
            No database record for this asset. Restart the server and resend from Carl to create records for all assets.
          </div>
        )}

        {/* Asset Type Selector - show in edit mode or add mode when showAssetTypeSelector is true */}
        {(!isAddMode || showAssetTypeSelector) && (
          <div className="prompt-editor-type">
            <label>Media Type</label>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              className={!isAddMode && assetTypeChanged ? 'type-changed' : ''}
            >
              {isAddMode && <option value="">-- Select Type --</option>}
              {!isAddMode && <option value="">-- Select Type --</option>}
              {MEDIA_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
              {/* Include current type if not in list */}
              {assetType && !MEDIA_TYPES.find(t => t.value === assetType) && (
                <option value={assetType}>
                  {assetType.replace(/_/g, ' ')}
                </option>
              )}
            </select>
            {!isAddMode && assetTypeChanged && (
              <span className="type-change-indicator">Changed</span>
            )}
          </div>
        )}

        <div className="prompt-editor-body">
          <label>Generation Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            autoFocus
          />
        </div>

        <div className="prompt-editor-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-save" onClick={handleSave} disabled={!hasRecord}>
            {isAddMode ? 'Add Asset' : (assetTypeChanged ? 'Save Changes' : 'Save Prompt')}
          </button>
        </div>
      </div>
    </div>
  );
}
