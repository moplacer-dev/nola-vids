export default function ImagePreview({ image, audio, onRegenerate, onRegenerateAudio }) {
  // If audio is selected, show audio preview
  if (audio) {
    const hasAudio = (audio.status === 'completed' || audio.status === 'uploaded') && audio.audioPath;
    // audioPath is the full Supabase public URL - use directly with cache buster
    const audioUrl = hasAudio ? `${audio.audioPath}?t=${encodeURIComponent(audio.updatedAt || '')}` : null;
    const audioDownloadUrl = hasAudio ? audio.audioPath : null;

    const handleDownload = () => {
      if (!audioDownloadUrl) return;
      const link = document.createElement('a');
      link.href = audioDownloadUrl;
      link.download = audio.cmsFilename || `audio_${audio.id}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    return (
      <div className="image-preview audio-preview">
        <h3>Audio Preview</h3>

        {hasAudio ? (
          <>
            <div className="audio-player-container">
              <audio
                key={audioUrl}
                src={audioUrl}
                controls
                preload="metadata"
                className="preview-audio"
              />
            </div>
            <div className="preview-filename">
              {audio.cmsFilename}
            </div>
            {audio.voiceName && (
              <div className="preview-voice">
                Voice: {audio.voiceName}
              </div>
            )}
            <div className="preview-actions">
              <button className="btn-download" onClick={handleDownload}>
                Download
              </button>
              {onRegenerateAudio && (
                <button
                  className="btn-regenerate"
                  onClick={() => onRegenerateAudio(audio.id)}
                >
                  Regenerate
                </button>
              )}
            </div>
          </>
        ) : audio.status === 'generating' ? (
          <div className="preview-placeholder">
            Generating audio...
          </div>
        ) : audio.status === 'failed' ? (
          <div className="preview-placeholder">
            Generation failed. Try regenerating.
          </div>
        ) : (
          <div className="preview-placeholder">
            Click Generate to create audio
          </div>
        )}
      </div>
    );
  }

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

  // Check for video (MG video) - videoPath indicates this is a video asset
  const hasVideo = image.videoPath && image.status === 'uploaded';
  const videoUrl = hasVideo ? image.videoPath : null;

  const hasImage = !hasVideo && (image.status === 'completed' || image.status === 'uploaded' || image.status === 'imported' || image.status === 'default') && image.imagePath;
  // Use full Supabase URL directly, add updatedAt as cache-buster
  const imageUrl = hasImage ? `${image.imagePath}?t=${encodeURIComponent(image.updatedAt || '')}` : null;

  // Only use character anchor for character-related asset types
  const assetType = (image.assetType || '').toLowerCase();
  const isCharacterAsset = assetType.includes('career') ||
                           assetType.includes('character') ||
                           assetType.includes('intro') ||
                           assetType.includes('motion_graphics');

  const handleDownload = () => {
    if (hasVideo && videoUrl) {
      // Direct download for video (local path)
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = image.cmsFilename || `video_${image.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    if (!imageUrl) return;

    const filename = image.cmsFilename || `image_${image.id}.png`;
    // Remove cache buster for download URL
    const downloadUrl = imageUrl.split('?')[0];

    // Use server proxy for Supabase URLs to handle CORS
    if (downloadUrl.startsWith('http') && downloadUrl.includes('supabase')) {
      const proxyUrl = `/api/download?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(filename)}`;
      window.location.href = proxyUrl;
    } else {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="image-preview">
      <h3>Preview</h3>

      {hasVideo ? (
        <>
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            preload="metadata"
            playsInline
            className="preview-video"
          />
          <div className="preview-filename">
            {image.cmsFilename}
          </div>
          <div className="preview-actions">
            <button className="btn-download" onClick={handleDownload}>
              Download
            </button>
          </div>
        </>
      ) : hasImage ? (
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
