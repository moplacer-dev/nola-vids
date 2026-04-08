import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import './ImageGenForm.css';

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 (Landscape)' },
  { value: '3:2', label: '3:2 (Photo)' },
  { value: '4:3', label: '4:3 (Standard)' },
  { value: '1:1', label: '1:1 (Square)' },
];

const ImageGenForm = forwardRef(function ImageGenForm({ onGenerate, disabled }, ref) {
  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState([]);
  const [referencePreviews, setReferencePreviews] = useState([]);
  const [referenceUrls, setReferenceUrls] = useState([]); // URL-based references (for refine)
  const [moduleName, setModuleName] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [aspectRatio, setAspectRatio] = useState('4:3');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Expose methods for external control
  useImperativeHandle(ref, () => ({
    addReferenceUrl: (url) => {
      const totalRefs = referenceImages.length + referenceUrls.length;
      if (totalRefs < 3 && url) {
        setReferenceUrls(prev => [...prev, url]);
      }
    },
    setPrompt: (text) => {
      setPrompt(text || '');
    }
  }));

  const handleFilesSelected = (files) => {
    if (files.length === 0) return;

    // Limit to 14 total images (including URL refs)
    const remainingSlots = 14 - referenceImages.length - referenceUrls.length;
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

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    handleFilesSelected(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleFilesSelected(files);
  };

  const handleRemoveImage = (index) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferencePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveUrl = (index) => {
    setReferenceUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setReferenceImages([]);
    setReferencePreviews([]);
    setReferenceUrls([]);
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
      referenceUrls,
      aspectRatio,
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
        <p className="field-hint">Upload up to 14 reference images for character or style consistency</p>

        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <div
          className={`reference-dropzone ${isDragging ? 'dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {referencePreviews.length === 0 && referenceUrls.length === 0 ? (
            <div className="dropzone-content">
              <span className="dropzone-icon">[+]</span>
              <span className="dropzone-text">Drag images here or click to browse</span>
              <span className="dropzone-hint">Up to 14 reference images</span>
            </div>
          ) : (
            <div className="reference-grid" onClick={(e) => e.stopPropagation()}>
              {/* URL-based references (from refine) */}
              {referenceUrls.map((url, index) => (
                <div key={`url-${index}`} className="reference-preview-item">
                  <img src={url} alt={`Reference ${index + 1}`} />
                  <button
                    type="button"
                    className="btn-remove-reference"
                    onClick={() => handleRemoveUrl(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {/* File-based references */}
              {referencePreviews.map((preview, index) => (
                <div key={`file-${index}`} className="reference-preview-item">
                  <img src={preview} alt={`Reference ${referenceUrls.length + index + 1}`} />
                  <button
                    type="button"
                    className="btn-remove-reference"
                    onClick={() => handleRemoveImage(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {referenceImages.length + referenceUrls.length < 3 && (
                <div
                  className="add-more-zone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  +
                </div>
              )}
            </div>
          )}
        </div>

        {(referenceImages.length > 0 || referenceUrls.length > 0) && (
          <button
            type="button"
            className="btn-clear-all-references"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      <div className="settings-row">
        <div className="form-group">
          <label className="form-label">Aspect Ratio</label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="form-select"
            disabled={disabled}
          >
            {ASPECT_RATIOS.map(ar => (
              <option key={ar.value} value={ar.value}>{ar.label}</option>
            ))}
          </select>
        </div>
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
});

export default ImageGenForm;
