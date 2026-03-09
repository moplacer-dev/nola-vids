import { useState, useRef } from 'react';
import './ImageGenForm.css';

export default function ImageGenForm({ onGenerate, disabled }) {
  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState([]);
  const [referencePreviews, setReferencePreviews] = useState([]);
  const [moduleName, setModuleName] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 3 total images
    const remainingSlots = 3 - referenceImages.length;
    const filesToAdd = files.slice(0, remainingSlots);

    // Add files to state
    setReferenceImages(prev => [...prev, ...filesToAdd]);

    // Create preview URLs for new files
    filesToAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setReferencePreviews(prev => [...prev, e.target.result]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (index) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferencePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setReferenceImages([]);
    setReferencePreviews([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    onGenerate({
      prompt: prompt.trim(),
      referenceImages,
      moduleName: moduleName.trim() || null,
      sessionNumber: sessionNumber ? parseInt(sessionNumber) : null,
      pageNumber: pageNumber ? parseInt(pageNumber) : null
    });
  };

  const generateFilename = () => {
    if (moduleName && sessionNumber && pageNumber) {
      const moduleCode = moduleName.substring(0, 4).toUpperCase();
      return `MOD.${moduleCode}.${sessionNumber}.${pageNumber}.IMG1.png`;
    }
    return 'Generated filename will appear here';
  };

  return (
    <form className="image-gen-form" onSubmit={handleSubmit}>
      <div className="form-section">
        <label>Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          rows={4}
          disabled={disabled}
        />
      </div>

      <div className="form-section">
        <label>Reference Images (Optional)</label>
        <p className="field-hint">Upload up to 3 reference images for character or style consistency</p>

        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {referencePreviews.length > 0 ? (
          <div className="reference-grid">
            {referencePreviews.map((preview, index) => (
              <div key={index} className="reference-preview-item">
                <img src={preview} alt={`Reference ${index + 1}`} />
                <button
                  type="button"
                  className="btn-remove-reference"
                  onClick={() => handleRemoveImage(index)}
                >
                  ×
                </button>
              </div>
            ))}
            {referenceImages.length < 3 && (
              <button
                type="button"
                className="btn-add-more-reference"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
              >
                + Add
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="btn-upload-reference"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Upload Reference Images
          </button>
        )}

        {referenceImages.length > 0 && (
          <button
            type="button"
            className="btn-clear-all-references"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      <div className="form-section">
        <label>File Naming (Optional)</label>
        <p className="field-hint">For CMS organization - leave blank for auto-generated name</p>

        <div className="naming-fields">
          <div className="naming-field">
            <span className="naming-label">Module Acronym</span>
            <input
              type="text"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="e.g. REAC"
              disabled={disabled}
            />
          </div>
          <div className="naming-field">
            <span className="naming-label">Session</span>
            <input
              type="number"
              value={sessionNumber}
              onChange={(e) => setSessionNumber(e.target.value)}
              placeholder="e.g. 3"
              min="1"
              disabled={disabled}
            />
          </div>
          <div className="naming-field">
            <span className="naming-label">Page</span>
            <input
              type="number"
              value={pageNumber}
              onChange={(e) => setPageNumber(e.target.value)}
              placeholder="e.g. 4"
              min="1"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="filename-preview">
          {generateFilename()}
        </div>
      </div>

      <button
        type="submit"
        className="btn-generate-image"
        disabled={disabled || !prompt.trim()}
      >
        {disabled ? 'Generating...' : 'Generate Image'}
      </button>
    </form>
  );
}
