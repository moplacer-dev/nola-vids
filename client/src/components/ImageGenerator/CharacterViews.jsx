import { useEffect, useState } from 'react';

const SLOTS = [
  { key: 'front', label: 'Front View', imageIdField: 'frontViewImageId' },
  { key: 'three_quarter', label: 'Three-Quarter View', imageIdField: 'threeQuarterViewImageId' },
  { key: 'side', label: 'Side View', imageIdField: 'sideViewImageId' },
  { key: 'back', label: 'Back View', imageIdField: 'backViewImageId' }
];

// Reuse the same supabase-transform optimization that CharacterPanel applies
// to reference images, so view slots load at thumbnail resolution.
function resolveImageSrc(imagePath) {
  if (!imagePath) return null;
  const url = imagePath.startsWith('http') ? imagePath : `/anchors/${imagePath}`;
  if (url.includes('supabase.co/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=80';
  }
  return url;
}

export default function CharacterViews({ characterId, getCharacterViews }) {
  const [viewState, setViewState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!characterId || !getCharacterViews) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getCharacterViews(characterId)
      .then(data => {
        if (cancelled) return;
        setViewState(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load views');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [characterId, getCharacterViews]);

  if (!characterId) return null;

  if (loading) {
    return (
      <div className="character-views">
        <h4 className="character-views-heading">Reference Views</h4>
        <div className="character-views-status">Loading reference views...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="character-views">
        <h4 className="character-views-heading">Reference Views</h4>
        <div className="character-views-error">Could not load views: {error}</div>
      </div>
    );
  }

  if (!viewState) return null;

  const views = Array.isArray(viewState.views) ? viewState.views : [];

  return (
    <div className="character-views">
      <h4 className="character-views-heading">Reference Views</h4>
      <div className="view-slots-grid">
        {SLOTS.map(slot => {
          const imageId = viewState[slot.imageIdField];
          const view = imageId ? views.find(v => v.id === imageId) : null;
          const src = view ? resolveImageSrc(view.imagePath) : null;

          return (
            <div key={slot.key} className="view-slot">
              <div className="view-slot-label">{slot.label}</div>
              <div className="view-slot-frame">
                {src ? (
                  <img
                    className="view-slot-image"
                    src={src}
                    alt={`${slot.label} of ${viewState.characterName || 'character'}`}
                  />
                ) : (
                  <div className="view-slot-empty">Not generated yet</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
