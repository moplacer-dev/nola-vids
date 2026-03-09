import { useState, useRef } from 'react';

export default function MotionGraphicsGroup({
  slideNumber,
  slideTitle,
  scenes = [],  // Default to empty array
  assets = [],  // Raw assets with context fields
  mgVideo,
  audio,
  onGenerate,
  onUpload,
  onImport,
  onEditPrompt,
  onSelectImage,
  onSelectVideo,
  onUploadVideo,
  onDeleteVideo,
  onAddScene,
  onDeleteScene,
  onGenerateAudio,
  onUploadAudio,
  onEditNarration,
  onSelectAudio,
  voices = [],
  defaultVoiceId,
  selectedImageId,
  selectedVideoId,
  selectedAudioId,
  loading
}) {
  const [expanded, setExpanded] = useState(true);
  const [narrationExpanded, setNarrationExpanded] = useState(false);
  const [characterToggles, setCharacterToggles] = useState({});
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);

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

  // Check if this MG video is currently selected
  const isVideoSelected = hasVideo && mgVideo?.id === selectedVideoId;

  const handleHeaderClick = (e) => {
    // If clicking on the expand button, just toggle expand
    if (e.target.closest('.mg-expand-btn')) {
      setExpanded(!expanded);
      return;
    }

    // If video exists, select it for preview
    if (hasVideo && onSelectVideo) {
      onSelectVideo(mgVideo);
    } else {
      // Otherwise just toggle expand
      setExpanded(!expanded);
    }
  };

  return (
    <div className={`mg-group ${hasVideo ? 'has-video' : ''} ${isVideoSelected ? 'video-selected' : ''}`}>
      {/* Header - clickable to select video when available */}
      <div
        className={`mg-group-header ${hasVideo ? 'clickable-video' : ''} ${isVideoSelected ? 'selected' : ''}`}
        onClick={handleHeaderClick}
      >
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
          <button className="mg-expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="mg-group-content">
          {/* Video Controls Section - compact, no embedded player */}
          <div className="mg-video-controls">
            {hasVideo ? (
              <div className="mg-video-info-bar">
                <span className="mg-video-filename">{mgVideo.cmsFilename}</span>
                <div className="mg-video-actions">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={(e) => { e.stopPropagation(); videoInputRef.current?.click(); }}
                  >
                    Replace
                  </button>
                  <button
                    className="btn-secondary btn-sm btn-danger"
                    onClick={(e) => { e.stopPropagation(); onDeleteVideo(slideNumber); }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="mg-upload-bar">
                <button
                  className="btn-upload-video"
                  onClick={(e) => { e.stopPropagation(); videoInputRef.current?.click(); }}
                >
                  Upload Final Video
                </button>
                <span className="mg-upload-hint">
                  Upload the completed motion graphics video (.mp4)
                </span>
              </div>
            )}
          </div>

          {/* Hidden video input */}
          <input
            type="file"
            accept="video/mp4"
            style={{ display: 'none' }}
            ref={videoInputRef}
            onChange={handleVideoUpload}
          />

          {/* Scenes Grid */}
          <div className={`mg-scenes-section ${hasVideo ? 'scenes-secondary' : ''}`}>
            <div className="mg-scenes-header">
              <span className="mg-scenes-label">
                {hasVideo ? 'Reference Scenes' : 'Scene Images'}
              </span>
              {hasVideo && <span className="mg-scenes-hint">(click header to preview video)</span>}
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
                        className="btn-sm btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditScene(scene);
                        }}
                        title="Edit prompt"
                      >
                        ✎
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
                        className="btn-sm btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.[scene.id]?.click();
                        }}
                        disabled={!scene.id || loading}
                        title="Upload image"
                      >
                        ⬆
                      </button>
                      {scene.characterId && (
                        <label className="character-toggle mg-character-toggle" onClick={(e) => e.stopPropagation()} title="Include character">
                          <input
                            type="checkbox"
                            checked={characterToggles[scene.id] ?? true}
                            onChange={(e) => {
                              setCharacterToggles(prev => ({
                                ...prev,
                                [scene.id]: e.target.checked
                              }));
                            }}
                          />
                        </label>
                      )}
                      <button
                        className="btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (scene.id) {
                            const hasCharacter = !!scene.characterId;
                            const useCharacter = characterToggles[scene.id] ?? true;
                            onGenerate(scene.id, { useCharacterAnchor: hasCharacter && useCharacter });
                          }
                        }}
                        disabled={!scene.id || scene.status === 'generating' || loading}
                        title="Generate image"
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

          {/* Narration Section */}
          {audio && (
            <div className={`narration-section ${narrationExpanded ? 'expanded' : ''} ${selectedAudioId === audio.id ? 'selected' : ''}`}>
              <div
                className="narration-header"
                onClick={() => setNarrationExpanded(!narrationExpanded)}
              >
                <div className="narration-header-left">
                  <span className="narration-expand">{narrationExpanded ? '▼' : '▶'}</span>
                  <span className="narration-label">NARRATION</span>
                </div>
                <span className={`narration-status status-${audio.status}`}>
                  {audio.status.toUpperCase()}
                </span>
              </div>

              {narrationExpanded && (
                <div className="narration-content">
                  <p className="narration-text">
                    {audio.narrationText || 'No narration text'}
                  </p>

                  <div className="narration-voice-row">
                    <label>Voice:</label>
                    <select
                      value={audio.voiceId || defaultVoiceId || ''}
                      onChange={(e) => {
                        const voice = voices.find(v => v.voice_id === e.target.value);
                        if (onEditNarration) {
                          onEditNarration(audio.id, {
                            voiceId: e.target.value,
                            voiceName: voice?.name || ''
                          });
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {voices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="narration-actions">
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEditNarration) {
                          onEditNarration(audio.id, { editText: true });
                        }
                      }}
                    >
                      Edit
                    </button>
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav"
                      style={{ display: 'none' }}
                      ref={audioInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && audio?.id && onUploadAudio) {
                          onUploadAudio(audio.id, file);
                          e.target.value = '';
                        }
                      }}
                    />
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        audioInputRef.current?.click();
                      }}
                      disabled={loading}
                    >
                      Upload
                    </button>
                    <button
                      className="btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onGenerateAudio) {
                          onGenerateAudio(audio.id, {
                            voiceId: audio.voiceId || defaultVoiceId
                          });
                        }
                      }}
                      disabled={audio.status === 'generating' || loading}
                    >
                      {(audio.status === 'completed' || audio.status === 'uploaded') ? 'Regen' : 'Gen'}
                    </button>
                    {(audio.status === 'completed' || audio.status === 'uploaded') && (
                      <button
                        className="btn-preview"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectAudio) onSelectAudio(audio);
                        }}
                      >
                        Preview
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
