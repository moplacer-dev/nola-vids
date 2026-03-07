import { useState, useRef } from 'react';
import './ImageGenForm.css';

export default function ImageGenForm({ onGenerate, disabled }) {
  const [prompt, setPrompt] = useState('');
  const [referenceImage, setReferenceImage] = useState(null);
  const [referencePreview, setReferencePreview] = useState(null);
  const [moduleName, setModuleName] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setReferenceImage(file);
      // Create preview URL
      const reader = new FileReader();
      reader.onload = (e) => setReferencePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleClearReference = () => {
    setReferenceImage(null);
    setReferencePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    onGenerate({
      prompt: prompt.trim(),
      referenceImage,
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
        <label>Reference Image (Optional)</label>
        <p className="field-hint">Upload a reference image for character or style consistency</p>

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {referencePreview ? (
          <div className="reference-preview">
            <img src={referencePreview} alt="Reference" />
            <button
              type="button"
              className="btn-clear-reference"
              onClick={handleClearReference}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-upload-reference"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Upload Reference Image
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
