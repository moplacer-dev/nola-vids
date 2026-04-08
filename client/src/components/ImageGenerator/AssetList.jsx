import { useRef, useState } from 'react';
import AssessmentNarrationPanel from './AssessmentNarrationPanel';

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
  onAddAsset,
  onDeleteAsset,
  onGenerateAudio,
  onUploadAudio,
  onEditNarration,
  onSelectAudio,
  onGenerateAllAudio,  // For multi-part bulk generation
  onAddNarration,
  onDeleteNarration,
  onPushToCms,
  cmsAvailable = false,
  cmsPageMapping = {},
  selectedImageId,
  selectedVideoId,
  selectedAudioId,
  loading
}) {
  const fileInputRefs = useRef({});
  const videoInputRefs = useRef({});
  const [characterToggles, setCharacterToggles] = useState({});
  const [aspectRatioOverrides, setAspectRatioOverrides] = useState({});
  const [filterType, setFilterType] = useState('all');

  // Helper to determine default aspect ratio based on asset type
  const getDefaultAspectRatio = (assetType) => {
    const t = (assetType || '').toLowerCase();
    if (t.includes('career') || t.includes('character') ||
        t.includes('intro') || t.includes('motion_graphics')) {
      return '16:9';
    }
    return '4:3';
  };

  // Helper to check if an asset type is video-related
  const isVideoType = (type) => {
    const t = (type || '').toLowerCase();
    return t.includes('video') || t.includes('motion_graphics') || t.includes('animation') || t.includes('time_lapse');
  };

  // Build the data - key includes assetNumber for multi-asset slides
  const imageByKey = {};
  generatedImages?.forEach(img => {
    const assetNum = img.assetNumber || 1;
    imageByKey[`${img.slideNumber}-${img.assetType}-${assetNum}`] = img;
  });

  // Build metadata map from imported assets for context fields (Why, Production Notes, etc.)
  const assetMetadataByKey = {};
  assets?.forEach(asset => {
    const slideNum = String(asset.slideNumber ?? asset.slide_number ?? '');
    const type = asset.type || asset.assetType || 'image';
    const assetNum = asset.assetNumber ?? asset.asset_number ?? 1;
    if (slideNum) {
      const key = `${slideNum}-${type}-${assetNum}`;
      assetMetadataByKey[key] = asset;
    }
  });

  // Group generatedImages by slide number for database-first rendering
  const imagesBySlide = {};
  generatedImages?.forEach(img => {
    const slideNum = String(img.slideNumber);
    if (!imagesBySlide[slideNum]) imagesBySlide[slideNum] = [];
    imagesBySlide[slideNum].push(img);
  });

  // Build MG videos map by slide number
  const mgVideoBySlide = {};
  motionGraphicsVideos?.forEach(v => {
    mgVideoBySlide[v.slideNumber] = v;
  });

  // Build audio map by slide number (array to support multi-part narration)
  const audioBySlide = {};
  generatedAudio?.forEach(a => {
    const slideNum = a.slideNumber;
    if (!audioBySlide[slideNum]) {
      audioBySlide[slideNum] = [];
    }
    audioBySlide[slideNum].push(a);
  });

  // Track expanded slides (default: all collapsed)
  const [expandedSlides, setExpandedSlides] = useState({});

  const toggleSlide = (slideNumber) => {
    setExpandedSlides(prev => ({
      ...prev,
      [slideNumber]: !prev[slideNumber]
    }));
  };

  // Default slides to collapsed (false) unless explicitly expanded
  const isSlideExpanded = (slideNumber) => expandedSlides[slideNumber] === true;

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

      // Get database records for this slide (source of truth)
      const dbAssets = imagesBySlide[slideNum] || [];

      // Get imported assets for this slide (for pending items without DB records)
      const importedAssets = assetsBySlide[slideNum] || [];

      // Use database records as the source of truth (sorted by assetNumber)
      const renderedAssets = dbAssets
        .map(img => ({ ...img, _fromDb: true }))
        .sort((a, b) => (a.assetNumber || 1) - (b.assetNumber || 1));

      // Check if this slide has motion graphics assets (for final video section)
      const hasMGFromDb = dbAssets.some(img =>
        (img.assetType || '').toLowerCase().includes('motion_graphics')
      );
      const hasMGFromImports = importedAssets.some(a =>
        (a.type || '').toLowerCase().includes('motion_graphics')
      );

      return {
        slideNumber: slideNum,
        slideTitle: s.slideTitle || s.slide_title || s.title || '',
        slideType: s.slideType || s.slide_type || s.type || '',
        assets: renderedAssets,
        hasMGAssets: hasMGFromDb || hasMGFromImports
      };
    }).sort((a, b) => Number(a.slideNumber) - Number(b.slideNumber));
  }

  // Count slides with actual database assets (not just pending imports)
  const slidesWithAssets = slides.filter(s =>
    s.assets.some(a => a._fromDb === true)
  ).length;

  // Filter slides based on selected filter
  const filteredSlides = filterType === 'all'
    ? slides
    : slides.filter(slide => {
        const dbAssets = slide.assets.filter(a => a._fromDb === true);
        if (filterType === 'videos') {
          return dbAssets.some(a => isVideoType(a.assetType));
        }
        if (filterType === 'images') {
          return dbAssets.some(a => !isVideoType(a.assetType));
        }
        return true;
      });

  // Super simple render with zero CSS dependencies
  return (
    <div className="asset-list">
      <div className="asset-list-header">
        <h3>Slides ({filteredSlides.length}{filterType !== 'all' ? ` of ${slides.length}` : ''})</h3>
        <div className="asset-list-actions">
          <select
            className="filter-dropdown"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Assets</option>
            <option value="videos">Videos Only</option>
            <option value="images">Images Only</option>
          </select>
          <button
            className="btn-expand-all"
            onClick={() => {
              const allExpanded = {};
              filteredSlides.forEach(s => { allExpanded[s.slideNumber] = true; });
              setExpandedSlides(allExpanded);
            }}
            title="Expand all"
          >
            Expand All
          </button>
          <button
            className="btn-collapse-all"
            onClick={() => {
              const allCollapsed = {};
              filteredSlides.forEach(s => { allCollapsed[s.slideNumber] = false; });
              setExpandedSlides(allCollapsed);
            }}
            title="Collapse all"
          >
            Collapse All
          </button>
          <span className="asset-count">{slidesWithAssets} with media</span>
        </div>
      </div>

      <div className="asset-items">
        {filteredSlides.map((slide) => {
          const mgVideo = slide.hasMGAssets ? mgVideoBySlide[parseInt(slide.slideNumber)] : null;

          const expanded = isSlideExpanded(slide.slideNumber);

          // Count only database assets (not pending imports)
          const dbAssets = slide.assets.filter(asset => asset._fromDb === true);
          const assetCount = dbAssets.length;

          // Calculate slide completion status (media + narration)
          const slideAudioRecords = audioBySlide[parseInt(slide.slideNumber)] || [];
          const readyStatuses = ['completed', 'uploaded', 'imported', 'default'];

          // Count ready media assets (exclude MG scenes from completion - they're just for making the final video)
          const nonMGAssets = dbAssets.filter(asset => {
            const type = asset.assetType || 'image';
            return !type.toLowerCase().includes('motion_graphics');
          });
          // For DB assets, the asset IS the database record, so just check status directly
          const readyMediaCount = nonMGAssets.filter(asset =>
            readyStatuses.includes(asset.status)
          ).length;

          // Count ready narration assets
          const readyNarrationCount = slideAudioRecords.filter(a =>
            readyStatuses.includes(a.status)
          ).length;

          // For MG slides, check if final video is uploaded (mgVideo already defined above)
          const mgVideoReady = mgVideo && readyStatuses.includes(mgVideo.status) ? 1 : 0;
          const mgVideoRequired = slide.hasMGAssets ? 1 : 0;

          // Total counts (MG slides need the final video, not the scenes)
          const totalAssets = nonMGAssets.length + slideAudioRecords.length + mgVideoRequired;
          const readyAssets = readyMediaCount + readyNarrationCount + mgVideoReady;
          const isSlideComplete = totalAssets > 0 && readyAssets === totalAssets;
          const hasAnyAssets = totalAssets > 0 || dbAssets.length > 0;

          return (
          <div key={slide.slideNumber} className={`slide-group ${assetCount === 0 ? 'no-assets' : ''} ${expanded ? 'expanded' : 'collapsed'}`}>
            <div className="slide-header" onClick={() => toggleSlide(slide.slideNumber)}>
              <button className="slide-expand-btn" onClick={(e) => { e.stopPropagation(); toggleSlide(slide.slideNumber); }}>
                {expanded ? '▼' : '▶'}
              </button>
              <span className="slide-badge">{slide.slideNumber}</span>
              <div className="slide-info">
                <span className="slide-title">{slide.slideTitle || 'Untitled'}</span>
                {(() => {
                  // Get unique asset types for this slide
                  const types = [...new Set(dbAssets.map(a => a.assetType || 'image'))];
                  // Convert to short labels
                  const getShortLabel = (type) => {
                    const t = (type || '').toLowerCase();
                    if (t.includes('motion_graphics_scene')) return 'MG Scene';
                    if (t.includes('motion_graphics')) return 'MG';
                    if (t.includes('career_video')) return 'Career Vid';
                    if (t.includes('video') || t.includes('time_lapse')) return 'Video';
                    if (t.includes('diagram')) return 'Diagram';
                    if (t.includes('photo') || t.includes('composite')) return 'Photo';
                    if (t.includes('icon')) return 'Icon';
                    if (t.includes('infographic')) return 'Infographic';
                    if (t.includes('illustration')) return 'Illustration';
                    if (t.includes('screenshot')) return 'Screenshot';
                    if (t.includes('screen_recording')) return 'Screen Rec';
                    if (t.includes('animation')) return 'Animation';
                    if (t.includes('interactive')) return 'Interactive';
                    if (t.includes('image')) return 'Image';
                    return type.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase()).join('');
                  };
                  const labels = [...new Set(types.map(getShortLabel))];
                  return labels.map(label => (
                    <span key={label} className="asset-type-badge">{label}</span>
                  ));
                })()}
              </div>
              {!hasAnyAssets && <span className="no-media-badge">No Media</span>}
              {hasAnyAssets && (
                <span className={`slide-status-badge ${isSlideComplete ? 'complete' : 'in-progress'}`}>
                  {isSlideComplete ? 'Complete' : `${readyAssets}/${totalAssets}`}
                </span>
              )}
            </div>

            {/* Expanded Content */}
            {expanded && (
              <>
              {/* Final Video Section - only for MG slides */}
              {slide.hasMGAssets && (
              <div className="slide-final-video">
                <input
                  type="file"
                  accept="video/mp4"
                  style={{ display: 'none' }}
                  ref={el => videoInputRefs.current[slide.slideNumber] = el}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onUploadMGVideo(slide.slideNumber, file);
                      e.target.value = '';
                    }
                  }}
                />
                {mgVideo ? (
                  <div className="final-video-info">
                    <span className="final-video-label">Final Video:</span>
                    <span
                      className={`final-video-filename ${selectedVideoId === mgVideo.id ? 'selected' : ''}`}
                      onClick={() => onSelectVideo(mgVideo)}
                    >
                      {mgVideo.cmsFilename}
                    </span>
                    <div className="final-video-actions">
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => onSelectVideo(mgVideo)}
                      >
                        Preview
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => videoInputRefs.current[slide.slideNumber]?.click()}
                      >
                        Replace
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => onDeleteMGVideo(slide.slideNumber)}
                      >
                        Remove
                      </button>
                      {/* Push to CMS button for MG videos - always show */}
                      {onPushToCms && (
                        <button
                          className={`btn-push-cms btn-sm ${mgVideo.cmsPushStatus === 'pushed' ? 'pushed' : ''}`}
                          onClick={() => onPushToCms(mgVideo.id, 'mg-video')}
                          disabled={loading || mgVideo.cmsPushStatus === 'pushing'}
                          title={mgVideo.cmsPushStatus === 'pushed' ? 'Already pushed to CMS' : 'Push to CMS'}
                        >
                          {mgVideo.cmsPushStatus === 'pushed' ? '✓ Pushed' : 'Push to CMS'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn-upload-final-video"
                    onClick={() => videoInputRefs.current[slide.slideNumber]?.click()}
                  >
                    Upload Final Video
                  </button>
                )}
              </div>
            )}

            {slide.assets.map((asset, i) => {
              // Asset IS the database record (img)
              const img = asset;

              const type = asset.assetType || 'image';
              const assetNum = asset.assetNumber || 1;

              // Look up imported metadata using current type (for prompt fallback)
              const metadataKey = `${slide.slideNumber}-${type}-${assetNum}`;
              const importedMetadata = assetMetadataByKey[metadataKey];

              // Check if this asset has a character associated
              const hasCharacter = !!img?.characterId;

              // Default to using character for these types (but user can toggle off)
              const defaultUseCharacter = type.toLowerCase().includes('career') ||
                                          type.toLowerCase().includes('character') ||
                                          type.toLowerCase().includes('intro');

              // Get current toggle state, defaulting based on asset type
              const key = `${slide.slideNumber}-${type}-${assetNum}`;
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
                    <div className="asset-header-right">
                      <span className="status-text">
                        {img.status}
                      </span>
                      {img?.id && onDeleteAsset && (
                        <button
                          className="asset-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteAsset(img);
                          }}
                          title="Delete asset"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="asset-prompt">
                    {img?.modifiedPrompt || img?.originalPrompt || importedMetadata?.prompt || importedMetadata?.description || 'No prompt'}
                  </p>
                  <div className="asset-actions">
                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditPrompt(img);
                      }}
                    >
                      Edit Prompt
                    </button>
                    <input
                      type="file"
                      accept={isVideoAsset ? "video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
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
                      <div className="aspect-ratio-select" onClick={(e) => e.stopPropagation()}>
                        <label>Aspect:</label>
                        <select
                          value={aspectRatioOverrides[key] ?? getDefaultAspectRatio(type)}
                          onChange={(e) => setAspectRatioOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                        >
                          <option value="4:3">4:3 (image slides)</option>
                          <option value="16:9">16:9 (video slides)</option>
                        </select>
                      </div>
                    )}
                    {!isVideoAsset && (
                      <button
                        className="btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (img) onGenerate(img.id, {
                            useCharacterAnchor: hasCharacter && useCharacter,
                            aspectRatio: aspectRatioOverrides[key] ?? getDefaultAspectRatio(type)
                          });
                        }}
                        disabled={!img || img?.status === 'generating' || loading}
                      >
                        Generate
                      </button>
                    )}
                    {/* Push to CMS button - show for images and videos, but NOT for MG scenes (those are just for making the final video) */}
                    {onPushToCms && img && !type.toLowerCase().includes('motion_graphics') && (() => {
                      const isReady = readyStatuses.includes(img.status);
                      const isPushed = img.cmsPushStatus === 'pushed';
                      const isPushing = img.cmsPushStatus === 'pushing';
                      const getTitle = () => {
                        if (isPushed) return 'Already pushed to CMS';
                        if (!isReady) return `Upload or generate ${isVideoAsset ? 'video' : 'image'} first`;
                        return 'Push to CMS';
                      };
                      return (
                        <button
                          className={`btn-push-cms ${isPushed ? 'pushed' : ''} ${!isReady ? 'not-ready' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPushToCms(img.id, isVideoAsset ? 'video' : 'image');
                          }}
                          disabled={loading || isPushing || !isReady}
                          title={getTitle()}
                        >
                          {isPushed ? '✓ Pushed' : 'Push to CMS'}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })}

            {/* Add Asset Card */}
            {onAddAsset && (
              <div
                className="slide-add-asset"
                onClick={() => onAddAsset(slide.slideNumber)}
              >
                + Add Asset
              </div>
            )}

            {/* Narration Section */}
            {(() => {
              const slideAudioRecords = audioBySlide[parseInt(slide.slideNumber)] || [];
              if (slideAudioRecords.length === 0) return null;

              // Check if this is a multi-part slide (has question types, popup types, or multiple audio records)
              const isMultiPartSlide = slideAudioRecords.length > 1 || slideAudioRecords.some(a =>
                ['question', 'answer_a', 'answer_b', 'answer_c', 'answer_d', 'answer_e', 'correct_response', 'incorrect_1', 'incorrect_2',
                 'part_a_question', 'part_a_answer_a', 'part_a_answer_b', 'part_a_answer_c', 'part_a_answer_d',
                 'part_b_question', 'part_b_answer_a', 'part_b_answer_b', 'part_b_answer_c', 'part_b_answer_d',
                 'popup_1', 'popup_2', 'popup_3', 'popup_4', 'popup_5', 'popup_6', 'scenario', 'questions', 'answers'].includes(a.narrationType)
              );

              if (isMultiPartSlide) {
                return (
                  <AssessmentNarrationPanel
                    questionNumber={parseInt(slide.slideNumber)}
                    audioRecords={slideAudioRecords}
                    voices={voices}
                    defaultVoiceId={defaultVoiceId}
                    onGenerateAudio={onGenerateAudio}
                    onGenerateAll={onGenerateAllAudio}
                    onUploadAudio={onUploadAudio}
                    onEditNarration={onEditNarration}
                    onSelectAudio={onSelectAudio}
                    onAddNarration={onAddNarration}
                    onDeleteNarration={onDeleteNarration}
                    onPushToCms={onPushToCms}
                    cmsAvailable={cmsAvailable}
                    hasCmsPageMapping={!!cmsPageMapping[slide.slideNumber]}
                    selectedAudioId={selectedAudioId}
                    loading={loading}
                  />
                );
              }

              // Regular slide - use simple narration section
              const audio = slideAudioRecords.find(a => a.narrationType === 'slide_narration') || slideAudioRecords[0];
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
                    <div className="narration-header-right">
                      <span className={`narration-status status-${audio.status || 'pending'}`}>
                        {(audio.status || 'pending').toUpperCase()}
                      </span>
                      {onAddNarration && (
                        <button
                          className="btn-add-narration"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddNarration({ slideNumber: parseInt(slide.slideNumber) });
                          }}
                          disabled={loading}
                          title="Add narration part"
                        >
                          +
                        </button>
                      )}
                      {onDeleteNarration && (
                        <button
                          className="btn-delete-narration"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteNarration(audio.id);
                          }}
                          disabled={loading}
                          title="Delete narration"
                        >
                          ×
                        </button>
                      )}
                    </div>
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
                        {/* Push to CMS button for audio */}
                        {onPushToCms && (() => {
                          const audioReady = ['completed', 'uploaded'].includes(audio.status);
                          const isPushed = audio.cmsPushStatus === 'pushed';
                          const isPushing = audio.cmsPushStatus === 'pushing';
                          return (
                            <button
                              className={`btn-push-cms ${isPushed ? 'pushed' : ''} ${!audioReady ? 'not-ready' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPushToCms(audio.id, 'audio');
                              }}
                              disabled={loading || isPushing || !audioReady}
                              title={isPushed ? 'Already pushed to CMS' : !audioReady ? 'Generate or upload audio first' : 'Push to CMS'}
                            >
                              {isPushed ? '✓ Pushed' : 'Push to CMS'}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
              </>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
