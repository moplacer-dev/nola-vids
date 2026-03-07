export default function ImagePreview({ image, onRegenerate }) {
  if (!image) {
    return (
      <div className="image-preview">
        <h3>Preview</h3>
        <div className="preview-placeholder">
          Select an asset to preview
        </div>
      </div>
    );
  }

  const hasImage = (image.status === 'completed' || image.status === 'uploaded' || image.status === 'imported' || image.status === 'default') && image.imagePath;
  const imageUrl = hasImage ? `/images/${image.imagePath.split('/').pop()}` : null;

  // Only use character anchor for character-related asset types
  const assetType = (image.assetType || '').toLowerCase();
  const isCharacterAsset = assetType.includes('career') ||
                           assetType.includes('character') ||
                           assetType.includes('intro') ||
                           assetType.includes('motion_graphics');

  const handleDownload = () => {
    if (!imageUrl) return;

    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = image.cmsFilename || `image_${image.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="image-preview">
      <h3>Preview</h3>

      {hasImage ? (
        <>
          <img
            src={imageUrl}
            alt={`Slide ${image.slideNumber}`}
            className="preview-image"
          />
          <div className="preview-filename">
            {image.cmsFilename}
          </div>
          <div className="preview-actions">
            <button className="btn-download" onClick={handleDownload}>
              Download
            </button>
            <button
              className="btn-regenerate"
              onClick={() => onRegenerate(image.id, { useCharacterAnchor: isCharacterAsset })}
            >
              Regenerate
            </button>
          </div>
        </>
      ) : image.status === 'generating' ? (
        <div className="preview-placeholder">
          Generating image...
        </div>
      ) : image.status === 'failed' ? (
        <div className="preview-placeholder">
          Generation failed. Try regenerating.
        </div>
      ) : (
        <div className="preview-placeholder">
          Click Generate to create image
        </div>
      )}
    </div>
  );
}
