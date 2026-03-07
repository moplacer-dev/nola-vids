import { useRef, useState, useEffect } from 'react';

export default function AssetList({
  assets,
  slides: allSlides,
  generatedImages,
  onGenerate,
  onUpload,
  onImport,
  onEditPrompt,
  onSelectImage,
  selectedImageId,
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
    slides = allSlides.map(s => ({
      slideNumber: String(s.slideNumber ?? s.slide_number ?? ''),
      slideTitle: s.slideTitle || s.slide_title || s.title || '',
      slideType: s.slideType || s.slide_type || s.type || '',
      assets: assetsBySlide[String(s.slideNumber ?? s.slide_number ?? '')] || []
    })).sort((a, b) => Number(a.slideNumber) - Number(b.slideNumber));
  }

  const slidesWithAssets = slides.filter(s => s.assets.length > 0).length;

  // Super simple render with zero CSS dependencies
  return (
    <div className="asset-list">
      <div className="asset-list-header">
        <h3>Slides ({slides.length})</h3>
        <span className="asset-count">{slidesWithAssets} with media</span>
      </div>

      <div className="asset-items">
        {slides.map((slide) => (
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
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
