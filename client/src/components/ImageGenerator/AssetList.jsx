import { useRef, useState } from 'react';
import MotionGraphicsGroup from './MotionGraphicsGroup';

export default function AssetList({
  assets,
  slides: allSlides,
  generatedImages,
  motionGraphicsVideos = [],
  generatedAudio = [],
  voices = [],
  defaultVoiceId,
  onGenerate,
  onUpload,
  onImport,
  onEditPrompt,
  onSelectImage,
  onSelectVideo,
  onUploadMGVideo,
  onDeleteMGVideo,
  onAddScene,
  onDeleteScene,
  onGenerateAudio,
  onUploadAudio,
  onEditNarration,
  onSelectAudio,
  selectedImageId,
  selectedVideoId,
  selectedAudioId,
  loading
}) {
  const fileInputRefs = useRef({});
  const [characterToggles, setCharacterToggles] = useState({});

  // Build the data - key includes assetNumber for multi-asset slides
  const imageByKey = {};
  generatedImages?.forEach(img => {
    const assetNum = img.assetNumber || 1;
    imageByKey[`${img.slideNumber}-${img.assetType}-${assetNum}`] = img;
  });

  // Build MG videos map by slide number
  const mgVideoBySlide = {};
  motionGraphicsVideos?.forEach(v => {
    mgVideoBySlide[v.slideNumber] = v;
  });

  // Build audio map by slide number
  const audioBySlide = {};
  generatedAudio?.forEach(a => {
    audioBySlide[a.slideNumber] = a;
  });

  // Track expanded narration sections
  const [expandedNarrations, setExpandedNarrations] = useState({});
  const audioFileInputRefs = useRef({});

  const toggleNarration = (slideNumber) => {
    setExpandedNarrations(prev => ({
      ...prev,
      [slideNumber]: !prev[slideNumber]
    }));
  };

  const assetsBySlide = {};
  assets?.forEach(asset => {
    const num = String(asset.slideNumber ?? asset.slide_number ?? '');
    if (num) {
      if (!assetsBySlide[num]) assetsBySlide[num] = [];
      assetsBySlide[num].push(asset);
    }
  });

  let slides = [];
  if (allSlides?.length > 0) {
    slides = allSlides.map(s => {
      const slideNum = String(s.slideNumber ?? s.slide_number ?? '');
      const slideAssets = assetsBySlide[slideNum] || [];

      // Check if this slide has motion graphics scenes
      // Check both raw assets AND generatedImages for MG types
      const hasMGFromAssets = slideAssets.some(a =>
        (a.type || '').toLowerCase().includes('motion_graphics')
      );
      const hasMGFromImages = generatedImages?.some(img =>
        img.slideNumber === parseInt(slideNum) &&
        ((img.assetType || '').toLowerCase().includes('motion_graphics'))
      ) || false;

      const hasMGScenes = hasMGFromAssets || hasMGFromImages;

      return {
        slideNumber: slideNum,
        slideTitle: s.slideTitle || s.slide_title || s.title || '',
        slideType: s.slideType || s.slide_type || s.type || '',
        assets: slideAssets,
        isMotionGraphics: hasMGScenes
      };
    }).sort((a, b) => Number(a.slideNumber) - Number(b.slideNumber));
  }

  const slidesWithAssets = slides.filter(s => s.assets.length > 0).length;

  // Get MG scenes for a slide (from generatedImages)
  // Falls back to finding scenes via imageByKey when assetType doesn't match
  const getMGScenes = (slideNumber) => {
    // First try to get from generatedImages by assetType
    let scenes = generatedImages?.filter(img =>
      img.slideNumber === parseInt(slideNumber) &&
      ((img.assetType || '').toLowerCase().includes('motion_graphics'))
    ) || [];

    // If no scenes found, fall back to finding via assets + generatedImages by slideNumber/assetNumber
    if (scenes.length === 0) {
      const slideAssets = assetsBySlide[String(slideNumber)] || [];
      const mgAssets = slideAssets.filter(a =>
        (a.type || '').toLowerCase().includes('motion_graphics')
      );

      // Find generatedImages by slideNumber + assetNumber (avoiding type mismatch)
      scenes = mgAssets.map(asset => {
        const assetNum = asset.assetNumber ?? asset.asset_number ?? 1;
        return generatedImages?.find(img =>
          img.slideNumber === parseInt(slideNumber) &&
          (img.assetNumber || 1) === assetNum
        );
      }).filter(Boolean);
    }

    return scenes;
  };

  // Super simple render with zero CSS dependencies
  return (
    <div className="asset-list">
      <div className="asset-list-header">
        <h3>Slides ({slides.length})</h3>
        <span className="asset-count">{slidesWithAssets} with media</span>
      </div>

      <div className="asset-items">
        {slides.map((slide) => {
          // Render Motion Graphics slides with special component
          const mgScenes = slide.isMotionGraphics ? getMGScenes(slide.slideNumber) : [];

          if (slide.isMotionGraphics && (slide.assets.length > 0 || mgScenes.length > 0)) {
            const mgVideo = mgVideoBySlide[parseInt(slide.slideNumber)];

            const mgAudio = audioBySlide[parseInt(slide.slideNumber)];

            return (
              <MotionGraphicsGroup
                key={slide.slideNumber}
                slideNumber={slide.slideNumber}
                slideTitle={slide.slideTitle}
                scenes={mgScenes}
                assets={slide.assets}
                mgVideo={mgVideo}
                audio={mgAudio}
                onGenerate={onGenerate}
                onUpload={onUpload}
                onImport={onImport}
                onEditPrompt={onEditPrompt}
                onSelectImage={onSelectImage}
                onSelectVideo={onSelectVideo}
                onUploadVideo={onUploadMGVideo}
                onDeleteVideo={onDeleteMGVideo}
                onAddScene={onAddScene}
                onDeleteScene={onDeleteScene}
                onGenerateAudio={onGenerateAudio}
                onUploadAudio={onUploadAudio}
                onEditNarration={onEditNarration}
                onSelectAudio={onSelectAudio}
                voices={voices}
                defaultVoiceId={defaultVoiceId}
                selectedImageId={selectedImageId}
                selectedVideoId={selectedVideoId}
                selectedAudioId={selectedAudioId}
                loading={loading}
              />
            );
          }

          // Render normal slides
          return (
          <div key={slide.slideNumber} className={`slide-group ${slide.assets.length === 0 ? 'no-assets' : ''}`}>
            <div className="slide-header">
              <span className="slide-badge">{slide.slideNumber}</span>
              <div className="slide-info">
                <span className="slide-title">{slide.slideTitle || 'Untitled'}</span>
              </div>
              {slide.assets.length === 0 && <span className="no-media-badge">No Media</span>}
            </div>

            {slide.assets.map((asset, i) => {
              const type = asset.type || asset.assetType || 'image';
              const assetNum = asset.assetNumber ?? asset.asset_number ?? 1;
              const key = `${slide.slideNumber}-${type}-${assetNum}`;
              const img = imageByKey[key];

              const productionNotes = asset.productionNotes || asset.production_notes || '';
              const mediaTeamNotes = asset.mediaTeamNotes || asset.media_team_notes || asset.notes_for_media_team || '';
              const pedagogicalRationale = asset.pedagogicalRationale || asset.pedagogical_rationale || '';

              // Check if this asset has a character associated
              const hasCharacter = !!img?.characterId;

              // Default to using character for these types (but user can toggle off)
              const defaultUseCharacter = type.toLowerCase().includes('career') ||
                                          type.toLowerCase().includes('character') ||
                                          type.toLowerCase().includes('intro');

              // Get current toggle state, defaulting based on asset type
              const useCharacter = characterToggles[key] ?? defaultUseCharacter;

              // Check if this is a video asset (not motion graphics - those are handled separately)
              const isVideoAsset = type.toLowerCase() === 'video';

              return (
                <div
                  key={i}
                  className={`asset-item ${img?.id === selectedImageId ? 'selected' : ''}`}
                  onClick={() => img && onSelectImage(img)}
                  style={{ cursor: img ? 'pointer' : 'default' }}
                >
                  <div className="asset-header-row">
                    <span className="asset-type">
                      {type.replace(/_/g, ' ')}
                      {slide.assets.length > 1 && <span className="asset-number"> #{assetNum}</span>}
                    </span>
                    <span className={`status-text ${!img ? 'status-no-record' : ''}`}>
                      {img ? img.status : 'no record'}
                    </span>
                  </div>
                  <p className="asset-prompt">
                    {img?.modifiedPrompt || img?.originalPrompt || asset.prompt || asset.description || 'No prompt'}
                  </p>
                  {pedagogicalRationale && (
                    <p className="asset-rationale">
                      <span className="note-label">Why:</span> {pedagogicalRationale}
                    </p>
                  )}
                  {productionNotes && (
                    <p className="asset-note production-note">
                      <span className="note-label">Production Notes:</span> {productionNotes}
                    </p>
                  )}
                  {mediaTeamNotes && (
                    <p className="asset-note media-team-note">
                      <span className="note-label">For Media Team:</span> {mediaTeamNotes}
                    </p>
                  )}
                  <div className="asset-actions">
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Pass both the image record and the full asset context
                        onEditPrompt({
                          ...(img || { slideNumber: slide.slideNumber, assetType: type, assetNumber: assetNum, originalPrompt: asset.prompt || asset.description }),
                          // Include all context fields from the asset
                          asset: {
                            prompt: asset.prompt || asset.description || '',
                            pedagogicalRationale: pedagogicalRationale,
                            productionNotes: productionNotes,
                            mediaTeamNotes: mediaTeamNotes
                          }
                        });
                      }}
                    >
                      Edit Prompt
                    </button>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      ref={el => fileInputRefs.current[key] = el}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && img?.id) {
                          onUpload(img.id, file);
                          e.target.value = ''; // Reset for re-upload
                        }
                      }}
                    />
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRefs.current[key]?.click();
                      }}
                      disabled={!img?.id || loading}
                    >
                      Upload
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (img?.id) onImport(img.id);
                      }}
                      disabled={!img?.id || loading}
                    >
                      Import
                    </button>
                    {hasCharacter && (
                      <label
                        className="character-toggle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={useCharacter}
                          onChange={(e) => {
                            setCharacterToggles(prev => ({
                              ...prev,
                              [key]: e.target.checked
                            }));
                          }}
                        />
                        <span className="toggle-label">Character</span>
                      </label>
                    )}
                    {!isVideoAsset && (
                      <button
                        className="btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (img) onGenerate(img.id, { useCharacterAnchor: hasCharacter && useCharacter });
                        }}
                        disabled={!img || img?.status === 'generating' || loading}
                      >
                        Generate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Narration Section */}
            {(() => {
              const audio = audioBySlide[parseInt(slide.slideNumber)];
              if (!audio) return null;

              const isExpanded = expandedNarrations[slide.slideNumber];
              const hasAudio = audio.status === 'completed' || audio.status === 'uploaded';
              const isSelected = selectedAudioId === audio.id;

              return (
                <div className={`narration-section ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}`}>
                  <div
                    className="narration-header"
                    onClick={() => toggleNarration(slide.slideNumber)}
                  >
                    <div className="narration-header-left">
                      <span className="narration-expand">{isExpanded ? '▼' : '▶'}</span>
                      <span className="narration-label">NARRATION</span>
                    </div>
                    <span className={`narration-status status-${audio.status}`}>
                      {audio.status.toUpperCase()}
                    </span>
                  </div>

                  {isExpanded && (
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
                          ref={el => audioFileInputRefs.current[slide.slideNumber] = el}
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
                            audioFileInputRefs.current[slide.slideNumber]?.click();
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
                          {hasAudio ? 'Regen' : 'Gen'}
                        </button>
                        {hasAudio && (
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
              );
            })()}
          </div>
          );
        })}
      </div>
    </div>
  );
}
