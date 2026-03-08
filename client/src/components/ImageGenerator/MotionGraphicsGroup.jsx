import { useState, useRef } from 'react';

export default function MotionGraphicsGroup({
  slideNumber,
  slideTitle,
  scenes = [],  // Default to empty array
  assets = [],  // Raw assets with context fields
  mgVideo,
  onGenerate,
  onUpload,
  onImport,
  onEditPrompt,
  onSelectImage,
  onUploadVideo,
  onDeleteVideo,
  onAddScene,
  onDeleteScene,
  selectedImageId,
  loading
}) {
  const [expanded, setExpanded] = useState(!mgVideo?.videoPath);
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);

  // Ensure scenes is always an array
  const safeScenes = Array.isArray(scenes) ? scenes : [];

  const scenesReady = safeScenes.filter(s =>
    s && ['completed', 'uploaded', 'imported', 'default'].includes(s.status)
  ).length;
  const totalScenes = safeScenes.length;
  const hasVideo = mgVideo?.status === 'uploaded' && mgVideo?.videoPath;

  const handleVideoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadVideo(slideNumber, file);
      e.target.value = '';
    }
  };

  // Find matching raw asset for a scene to get context fields
  const getAssetForScene = (scene) => {
    const sceneAssetNum = scene.assetNumber || 1;
    return assets.find(a =>
      (a.assetNumber ?? a.asset_number ?? 1) === sceneAssetNum
    );
  };

  // Build edit data with context from raw asset
  const handleEditScene = (scene) => {
    const asset = getAssetForScene(scene);
    const productionNotes = asset?.productionNotes || asset?.production_notes || '';
    const mediaTeamNotes = asset?.mediaTeamNotes || asset?.media_team_notes || asset?.notes_for_media_team || '';
    const pedagogicalRationale = asset?.pedagogicalRationale || asset?.pedagogical_rationale || '';

    onEditPrompt({
      ...scene,
      asset: {
        prompt: asset?.prompt || asset?.description || '',
        pedagogicalRationale,
        productionNotes,
        mediaTeamNotes
      }
    });
  };

  return (
    <div className={`mg-group ${hasVideo ? 'has-video' : ''}`}>
      {/* Header */}
      <div className="mg-group-header" onClick={() => setExpanded(!expanded)}>
        <div className="mg-header-left">
          <span className="slide-badge">{slideNumber}</span>
          <div className="mg-header-info">
            <span className="slide-title">{slideTitle || 'Untitled'}</span>
            <span className="mg-label">MOTION GRAPHICS</span>
          </div>
        </div>
        <div className="mg-header-right">
          <div className="mg-status-badges">
            <span className={`mg-badge ${scenesReady === totalScenes ? 'ready' : 'pending'}`}>
              Scenes: {scenesReady}/{totalScenes}
            </span>
            <span className={`mg-badge ${hasVideo ? 'uploaded' : 'pending'}`}>
              Video: {hasVideo ? 'Uploaded' : 'Pending'}
            </span>
          </div>
          <button className="mg-expand-btn">
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="mg-group-content">
          {/* Video Section - shown prominently when video exists */}
          {hasVideo && (
            <div className="mg-video-section">
              <div className="mg-video-preview">
                <video
                  src={`/mg-videos/${mgVideo.cmsFilename}`}
                  controls
                  className="mg-video-player"
                />
              </div>
              <div className="mg-video-info">
                <span className="mg-video-filename">{mgVideo.cmsFilename}</span>
                <div className="mg-video-actions">
                  <a
                    href={`/mg-videos/${mgVideo.cmsFilename}`}
                    download={mgVideo.cmsFilename}
                    className="btn-secondary"
                  >
                    Download
                  </a>
                  <button
                    className="btn-secondary"
                    onClick={() => videoInputRef.current?.click()}
                  >
                    Replace
                  </button>
                  <button
                    className="btn-secondary btn-danger"
                    onClick={() => onDeleteVideo(slideNumber)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Upload Video Button - shown when no video */}
          {!hasVideo && (
            <div className="mg-upload-section">
              <button
                className="btn-upload-video"
                onClick={() => videoInputRef.current?.click()}
              >
                Upload Final Video
              </button>
              <span className="mg-upload-hint">
                Upload the completed motion graphics video (.mp4)
              </span>
            </div>
          )}

          {/* Hidden video input */}
          <input
            type="file"
            accept="video/mp4"
            style={{ display: 'none' }}
            ref={videoInputRef}
            onChange={handleVideoUpload}
          />

          {/* Scenes Grid */}
          <div className="mg-scenes-section">
            <div className="mg-scenes-header">
              <span className="mg-scenes-label">
                {hasVideo ? 'View Scenes' : 'Scene Images'}
              </span>
            </div>
            <div className="mg-scenes-grid">
              {safeScenes.map((scene, index) => {
                if (!scene) return null;  // Skip null/undefined scenes
                const sceneNum = scene.assetNumber || (index + 1);
                return (
                  <div
                    key={scene.id || `scene-${index}`}
                    className={`mg-scene-card ${scene.id === selectedImageId ? 'selected' : ''} status-${scene.status}`}
                    onClick={() => onSelectImage(scene)}
                  >
                    {/* Delete button */}
                    <button
                      className="mg-scene-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteScene(scene);
                      }}
                      title="Delete scene"
                    >
                      ×
                    </button>
                    <div className="mg-scene-thumbnail">
                      {scene.imagePath ? (
                        <img
                          src={`/images/${scene.cmsFilename}`}
                          alt={`Scene ${sceneNum}`}
                        />
                      ) : (
                        <div className="mg-scene-placeholder">
                          Scene {sceneNum}
                        </div>
                      )}
                      <span className={`mg-scene-status status-${scene.status}`}>
                        {scene.status}
                      </span>
                    </div>
                    <div className="mg-scene-actions">
                      <button
                        className="btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditScene(scene);
                        }}
                      >
                        Edit
                      </button>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        ref={el => fileInputRef.current = { ...fileInputRef.current, [scene.id]: el }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && scene.id) {
                            onUpload(scene.id, file);
                            e.target.value = '';
                          }
                        }}
                      />
                      <button
                        className="btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.[scene.id]?.click();
                        }}
                        disabled={!scene.id || loading}
                      >
                        Upload
                      </button>
                      <button
                        className="btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (scene.id) onGenerate(scene.id, {});
                        }}
                        disabled={!scene.id || scene.status === 'generating' || loading}
                      >
                        Gen
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Add Scene Card */}
              <div
                className="mg-scene-card mg-scene-add"
                onClick={() => onAddScene(slideNumber)}
              >
                <div className="mg-scene-thumbnail">
                  <div className="mg-scene-placeholder mg-add-placeholder">
                    + Add Scene
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
