import { useEffect, useRef, useState } from 'react';
import ImageGenForm from '../ImageGenForm';

const SLOTS = [
  { key: 'front', label: 'Front View', imageIdField: 'frontViewImageId', primary: true },
  { key: 'three_quarter', label: 'Three-Quarter View', imageIdField: 'threeQuarterViewImageId' },
  { key: 'side', label: 'Side View', imageIdField: 'sideViewImageId' },
  { key: 'back', label: 'Back View', imageIdField: 'backViewImageId' }
];

const SLOT_FRAMING = {
  front: 'Front view, head and upper torso, facing camera directly, neutral friendly expression, plain background.',
  three_quarter: 'Three-quarter angle view, head and upper torso, body slightly turned to the side, neutral friendly expression, plain background.',
  side: 'Side profile view, head and upper torso, facing left, neutral expression, plain background.',
  back: 'Back view, head and upper torso, facing away from camera, plain background.'
};

function resolveImageSrc(imagePath) {
  if (!imagePath) return null;
  return imagePath.startsWith('http') ? imagePath : `/anchors/${imagePath}`;
}

// ImageGenForm caps reference URLs at 3 (the upper bound Gemini honors reliably
// for character-consistency anchoring). Slice here so callers see the truncation
// at the source instead of having extra references silently dropped inside the form.
const MAX_REFERENCE_URLS = 3;

function getReferenceUrlsForSlot(character, slot, primaryViewUrl) {
  if (!character) return [];
  if (slot?.primary) {
    const uploads = Array.isArray(character.referenceImages) ? character.referenceImages : [];
    return uploads.slice(0, MAX_REFERENCE_URLS);
  }
  return primaryViewUrl ? [primaryViewUrl] : [];
}

function SlotGenerateModal({
  slot,
  character,
  primaryViewUrl,
  onClose,
  generateStandaloneImage,
  assignCharacterView,
  onSuccess
}) {
  const formRef = useRef(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Pre-populate prompt and reference URLs once the form mounts
  useEffect(() => {
    if (!formRef.current || !slot || !character) return;

    const appearance = (character.appearanceDescription || '').trim();
    const framing = SLOT_FRAMING[slot.key] || '';
    const prompt = [appearance, framing].filter(Boolean).join('\n\n').trim();
    formRef.current.setPrompt(prompt);

    const refs = getReferenceUrlsForSlot(character, slot, primaryViewUrl);
    for (const url of refs) {
      if (!url) continue;
      const fullUrl = url.startsWith('http') ? url : `/anchors/${url}`;
      formRef.current.addReferenceUrl(fullUrl);
    }
    // We deliberately only run this once per slot/character pair. Re-running
    // would keep stacking duplicate reference URLs onto the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot?.key, character?.id]);

  const handleGenerate = async (params) => {
    setError(null);
    setGenerating(true);
    try {
      const result = await generateStandaloneImage(params);
      if (!result?.id) {
        throw new Error('Generation succeeded but no image ID returned');
      }
      await assignCharacterView(character.id, slot.key, result.id);
      setGenerating(false);
      onSuccess();
    } catch (err) {
      console.error('Slot generation failed:', err);
      setError(err?.message || 'Generation failed. Please try again.');
      setGenerating(false);
    }
  };

  return (
    <div
      className="prompt-editor-overlay"
      onClick={generating ? undefined : onClose}
    >
      <div
        className="prompt-editor slot-generate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-editor-header">
          <h2>Generate {slot.label} for {character.characterName}</h2>
          <button
            className="prompt-editor-close"
            onClick={onClose}
            disabled={generating}
            aria-label="Close"
          >×</button>
        </div>

        <div className="slot-generate-modal-body">
          {error && (
            <div className="slot-generate-error">{error}</div>
          )}
          <ImageGenForm
            ref={formRef}
            onGenerate={handleGenerate}
            disabled={generating}
          />
        </div>
      </div>
    </div>
  );
}

export default function CharacterViews({
  characterId,
  character,
  getCharacterViews,
  assignCharacterView,
  generateStandaloneImage
}) {
  const [viewState, setViewState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSlot, setActiveSlot] = useState(null);

  useEffect(() => {
    if (!characterId) {
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
  }, [characterId, getCharacterViews, refreshKey]);

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
  const primaryView = viewState.frontViewImageId
    ? views.find(v => v.id === viewState.frontViewImageId)
    : null;
  const primaryViewUrl = primaryView?.imagePath
    ? (primaryView.imagePath.startsWith('http') ? primaryView.imagePath : `/anchors/${primaryView.imagePath}`)
    : null;
  const primaryGeneratedAt = primaryView?.createdAt || null;
  // Deliberate fail-soft: when these props aren't threaded (e.g. a future caller
  // that only wants the read-only grid), the Generate button hides and the four
  // slots still render correctly. The read-only render is the load-bearing part.
  const canGenerate = Boolean(character && assignCharacterView && generateStandaloneImage);

  const handleSuccess = () => {
    setActiveSlot(null);
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="character-views">
      <h4 className="character-views-heading">Reference Views</h4>
      <div className="view-slots-grid">
        {SLOTS.map(slot => {
          const imageId = viewState[slot.imageIdField];
          const view = imageId ? views.find(v => v.id === imageId) : null;
          const src = view ? resolveImageSrc(view.imagePath) : null;
          const slotCreatedAt = view?.createdAt || null;
          const isStale = !slot.primary
            && primaryGeneratedAt
            && slotCreatedAt
            && new Date(slotCreatedAt) < new Date(primaryGeneratedAt);

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
                {isStale && (
                  <div
                    className="view-slot-stale-badge"
                    title="Front view was regenerated after this. Consider regenerating to keep the character consistent."
                  >
                    May not match
                  </div>
                )}
              </div>
              {!src && canGenerate && (slot.primary || primaryViewUrl) && (
                <button
                  type="button"
                  className="view-slot-generate-btn"
                  onClick={() => setActiveSlot(slot)}
                >
                  Generate
                </button>
              )}
              {!src && canGenerate && !slot.primary && !primaryViewUrl && (
                <div className="view-slot-locked-hint">Generate front view first</div>
              )}
            </div>
          );
        })}
      </div>

      {activeSlot && canGenerate && (
        <SlotGenerateModal
          slot={activeSlot}
          character={character}
          primaryViewUrl={activeSlot.primary ? null : primaryViewUrl}
          onClose={() => setActiveSlot(null)}
          generateStandaloneImage={generateStandaloneImage}
          assignCharacterView={assignCharacterView}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
