import { useRef, useEffect } from 'react';

export default function ImagePreview({ image, audio, onRegenerate, onRegenerateAudio }) {
  // Calculate audio URL at top level for hooks
  const hasAudioReady = audio && (audio.status === 'completed' || audio.status === 'uploaded') && audio.audioPath;
  const audioUrl = hasAudioReady ? `${audio.audioPath}?t=${encodeURIComponent(audio.updatedAt || '')}` : null;

  // Ref and effect for autoplay when audio is selected
  const audioRef = useRef(null);

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(err => {
        // Browser may block autoplay - user already clicked so this is unlikely
        console.log('Autoplay prevented:', err);
      });
    }
  }, [audioUrl]);

  // If audio is selected, show audio preview
  if (audio) {
    const hasAudio = hasAudioReady;
    const audioDownloadUrl = hasAudio ? audio.audioPath : null;

    const handleDownload = () => {
      if (!audioDownloadUrl) return;
      const filename = audio.cmsFilename || `audio_${audio.id}.mp3`;

      // Use server proxy for Supabase URLs to handle CORS
      if (audioDownloadUrl.startsWith('http') && audioDownloadUrl.includes('supabase')) {
        const proxyUrl = `/download?url=${encodeURIComponent(audioDownloadUrl)}&filename=${encodeURIComponent(filename)}`;
        window.location.href = proxyUrl;
      } else {
        const link = document.createElement('a');
        link.href = audioDownloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    };

    return (
      <div className="image-preview audio-preview">
        <h3>Audio Preview</h3>

        {hasAudio ? (
          <>
            <div className="audio-player-container">
              <audio
                ref={audioRef}
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

  // Check for video - either MG video (videoPath) or regular video asset (assetType === 'video')
  const isVideoAsset = (image.assetType || '').toLowerCase() === 'video';
  const isVideoFile = image.imagePath && (
    image.imagePath.endsWith('.mp4') ||
    image.imagePath.endsWith('.mov') ||
    image.imagePath.endsWith('.webm') ||
    image.imagePath.includes('.mp4?') ||
    image.imagePath.includes('.mov?') ||
    image.imagePath.includes('.webm?')
  );
  const hasMGVideo = image.videoPath && image.status === 'uploaded';
  const hasVideo = hasMGVideo || ((isVideoAsset || isVideoFile) && (image.status === 'completed' || image.status === 'uploaded' || image.status === 'imported') && image.imagePath);
  const videoUrl = hasMGVideo ? image.videoPath : (hasVideo ? image.imagePath : null);

  const hasImage = !hasVideo && (image.status === 'completed' || image.status === 'uploaded' || image.status === 'imported' || image.status === 'default') && image.imagePath;
  // Use original storage URL with cache buster - Supabase Image Transforms CDN ignores custom query params
  // so we bypass transforms for reliable cache busting after regeneration
  const imageUrl = hasImage ? (() => {
    const url = image.imagePath;
    // Use updatedAt timestamp as cache buster to force reload after regeneration
    const cacheBuster = `t=${encodeURIComponent(image.updatedAt || Date.now())}`;
    return `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;
  })() : null;

  // Only use character anchor for character-related asset types
  const assetType = (image.assetType || '').toLowerCase();
  const isCharacterAsset = assetType.includes('career') ||
                           assetType.includes('character') ||
                           assetType.includes('intro') ||
                           assetType.includes('motion_graphics');

  // Helper to determine default aspect ratio based on asset type
  const getDefaultAspectRatio = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('career') || t.includes('character') ||
        t.includes('intro') || t.includes('motion_graphics')) {
      return '16:9';
    }
    return '4:3';
  };

  const handleDownload = () => {
    if (hasVideo && videoUrl) {
      const filename = image.cmsFilename || `video_${image.id}.mp4`;

      // Use server proxy for Supabase URLs to handle CORS
      if (videoUrl.startsWith('http') && videoUrl.includes('supabase')) {
        const proxyUrl = `/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
        window.location.href = proxyUrl;
      } else {
        const link = document.createElement('a');
        link.href = videoUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      return;
    }

    if (!imageUrl) return;

    const filename = image.cmsFilename || `image_${image.id}.png`;
    // Use original imagePath for downloads (not the render/transform URL)
    const downloadUrl = image.imagePath;

    // Use server proxy for Supabase URLs to handle CORS
    if (downloadUrl.startsWith('http') && downloadUrl.includes('supabase')) {
      const proxyUrl = `/download?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(filename)}`;
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

  // Add cache buster to video URL
  const videoUrlWithCache = videoUrl ? `${videoUrl}${videoUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(image.updatedAt || '')}` : null;

  return (
    <div className="image-preview">
      <h3>{image.slideNumber ? `Slide ${image.slideNumber}` : 'Preview'}</h3>

      {hasVideo ? (
        <>
          <video
            key={videoUrlWithCache}
            src={videoUrlWithCache}
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
            key={imageUrl}
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
              onClick={() => onRegenerate(image.id, {
                useCharacterAnchor: isCharacterAsset,
                aspectRatio: image.aspectRatio || getDefaultAspectRatio(image.assetType)
              })}
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
