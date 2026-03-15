import { useRef, useState, useEffect } from 'react';

export default function CharacterPanel({ characters, onSetAnchor, onRemoveReferenceImage }) {
  const fileInputRef = useRef({});
  const [viewingCharacter, setViewingCharacter] = useState(null);

  // Keep viewingCharacter in sync when characters prop updates
  useEffect(() => {
    if (viewingCharacter) {
      const updated = characters.find(c => c.id === viewingCharacter.id);
      if (updated) {
        setViewingCharacter(updated);
      }
    }
  }, [characters]);

  // Get reference images array (with fallback to legacy anchorImagePath)
  const getReferenceImages = (char) => {
    if (char.referenceImages && Array.isArray(char.referenceImages)) {
      return char.referenceImages;
    }
    return char.anchorImagePath ? [char.anchorImagePath] : [];
  };

  const handleFileSelect = (characterId, e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onSetAnchor(characterId, files);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current[characterId]) {
      fileInputRef.current[characterId].value = '';
    }
  };

  const handleRemoveImage = (characterId, imagePath) => {
    if (onRemoveReferenceImage) {
      onRemoveReferenceImage(characterId, imagePath);
    }
  };

  return (
    <div className="character-panel">
      <h3>Career Character</h3>
      {characters.map(char => {
        const refImages = getReferenceImages(char);
        const firstImage = refImages[0];

        return (
          <div key={char.id} className="character-card">
            <div className="character-anchor">
              {firstImage ? (
                <img
                  src={firstImage.startsWith('http') ? firstImage : `/anchors/${firstImage}`}
                  alt={char.characterName}
                />
              ) : (
                <span className="character-anchor-placeholder">?</span>
              )}
              {refImages.length > 1 && (
                <span className="character-ref-count">+{refImages.length - 1}</span>
              )}
            </div>

            <div className="character-info">
              <div className="character-name">{char.characterName}</div>
              {char.career && (
                <div className="character-career">{char.career}</div>
              )}

              <div className="character-actions">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  ref={el => fileInputRef.current[char.id] = el}
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileSelect(char.id, e)}
                />
                <button
                  className="btn-set-anchor"
                  onClick={() => fileInputRef.current[char.id]?.click()}
                  disabled={refImages.length >= 3}
                >
                  {refImages.length >= 3 ? 'Max 3' : refImages.length > 0 ? 'Add More' : 'Set Reference'}
                </button>
                <button
                  className="btn-view-anchor"
                  onClick={() => setViewingCharacter(char)}
                >
                  View
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Character Details Modal */}
      {viewingCharacter && (
        <div className="prompt-editor-overlay" onClick={() => setViewingCharacter(null)}>
          <div className="prompt-editor character-modal" onClick={e => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h2>{viewingCharacter.characterName}</h2>
              <button className="prompt-editor-close" onClick={() => setViewingCharacter(null)}>×</button>
            </div>

            <div className="character-modal-body">
              {(() => {
                const refImages = getReferenceImages(viewingCharacter);
                if (refImages.length > 0) {
                  return (
                    <div className="character-modal-images">
                      <div className="character-modal-images-grid">
                        {refImages.map((imgPath, index) => (
                          <div key={index} className="character-modal-image-item">
                            <img
                              src={(() => {
                                const url = imgPath.startsWith('http') ? imgPath : `/anchors/${imgPath}`;
                                if (url.includes('supabase.co/storage/v1/object/public/')) {
                                  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=80';
                                }
                                return url;
                              })()}
                              alt={`${viewingCharacter.characterName} ref ${index + 1}`}
                            />
                            {onRemoveReferenceImage && (
                              <button
                                className="btn-remove-modal-image"
                                onClick={() => handleRemoveImage(viewingCharacter.id, imgPath)}
                                title="Remove this reference image"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="character-modal-images-hint">
                        {refImages.length} of 3 reference images
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="character-modal-details">
                {viewingCharacter.career && (
                  <div className="character-detail">
                    <span className="detail-label">Career:</span>
                    <span className="detail-value">{viewingCharacter.career}</span>
                  </div>
                )}

                {viewingCharacter.appearanceDescription && (
                  <div className="character-detail">
                    <span className="detail-label">Appearance:</span>
                    <p className="detail-value">{viewingCharacter.appearanceDescription}</p>
                  </div>
                )}

                {viewingCharacter.appearsOnSlides && viewingCharacter.appearsOnSlides.length > 0 && (
                  <div className="character-detail">
                    <span className="detail-label">Appears on:</span>
                    <span className="detail-value">
                      {viewingCharacter.appearsOnSlides.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
