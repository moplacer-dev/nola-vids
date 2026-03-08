import { useRef, useState } from 'react';

export default function CharacterPanel({ characters, onSetAnchor }) {
  const fileInputRef = useRef({});
  const [viewingCharacter, setViewingCharacter] = useState(null);

  const handleFileSelect = (characterId, e) => {
    const file = e.target.files?.[0];
    if (file) {
      onSetAnchor(characterId, file);
    }
  };

  return (
    <div className="character-panel">
      <h3>Career Character</h3>
      {characters.map(char => (
        <div key={char.id} className="character-card">
          <div className="character-anchor">
            {char.anchorImagePath ? (
              <img
                src={`/anchors/${char.anchorImagePath.split('/').pop()}`}
                alt={char.characterName}
              />
            ) : (
              <span className="character-anchor-placeholder">?</span>
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
                ref={el => fileInputRef.current[char.id] = el}
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(char.id, e)}
              />
              <button
                className="btn-set-anchor"
                onClick={() => fileInputRef.current[char.id]?.click()}
              >
                {char.anchorImagePath ? 'Update Reference' : 'Set Reference'}
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
      ))}

      {/* Character Details Modal */}
      {viewingCharacter && (
        <div className="prompt-editor-overlay" onClick={() => setViewingCharacter(null)}>
          <div className="prompt-editor character-modal" onClick={e => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h2>{viewingCharacter.characterName}</h2>
              <button className="prompt-editor-close" onClick={() => setViewingCharacter(null)}>×</button>
            </div>

            <div className="character-modal-body">
              {viewingCharacter.anchorImagePath && (
                <div className="character-modal-image">
                  <img
                    src={`/anchors/${viewingCharacter.anchorImagePath.split('/').pop()}`}
                    alt={viewingCharacter.characterName}
                  />
                </div>
              )}

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
