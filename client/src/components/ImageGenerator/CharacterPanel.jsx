import { useRef } from 'react';

export default function CharacterPanel({ characters, onSetAnchor }) {
  const fileInputRef = useRef({});

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
                {char.anchorImagePath ? 'Update Anchor' : 'Set Anchor'}
              </button>
              {char.anchorImagePath && (
                <button className="btn-view-anchor">
                  View
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
