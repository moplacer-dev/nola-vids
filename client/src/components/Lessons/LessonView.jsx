import { useEffect, useState } from 'react';

function describeNarration(narration) {
  if (!narration) return '—';
  if (narration.kind === 'single') return 'single';
  if (narration.kind === 'structured') {
    const partCount = (narration.parts || []).length;
    return `structured (${partCount} part${partCount === 1 ? '' : 's'})`;
  }
  return narration.kind || '—';
}

function describeAsset(asset) {
  if (!asset) return 'unknown';
  if (asset.kind === 'interactive_element' && Array.isArray(asset.components)) {
    return `${asset.kind} (${asset.components.length} component${asset.components.length === 1 ? '' : 's'})`;
  }
  if ((asset.kind === 'career_video' || asset.kind === 'intro_video') && Array.isArray(asset.scenes)) {
    return `${asset.kind} (${asset.scenes.length} scene${asset.scenes.length === 1 ? '' : 's'})`;
  }
  return asset.kind || 'unknown';
}

export default function LessonView({ lessonId, getLesson, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getLesson(lessonId)
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [lessonId, getLesson]);

  if (error) {
    return (
      <div className="lesson-view">
        <button className="btn-back" onClick={onBack}>Back</button>
        <div className="lesson-error">Failed to load lesson: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="lesson-view">
        <button className="btn-back" onClick={onBack}>Back</button>
        <div>Loading lesson...</div>
      </div>
    );
  }

  const { lesson, images = [], audio = [] } = data;
  const slides = lesson.slidesJson || [];

  const imagesBySlide = images.reduce((acc, img) => {
    const key = img.slideNumber ?? 0;
    (acc[key] = acc[key] || []).push(img);
    return acc;
  }, {});
  const audioBySlide = audio.reduce((acc, a) => {
    const key = a.slideNumber ?? 0;
    (acc[key] = acc[key] || []).push(a);
    return acc;
  }, {});

  return (
    <div className="lesson-view">
      <button className="btn-back" onClick={onBack}>Back</button>
      <header className="lesson-header">
        <h2>{lesson.moduleName} — {lesson.lessonLabel}</h2>
        <div className="lesson-meta">
          <span>Type: {lesson.lessonType}</span>
          <span>Schema: {lesson.schemaVersion}</span>
          <span>Character: {lesson.careerCharacterRef || '—'}</span>
          <span>Voice: {lesson.defaultVoiceName || lesson.defaultVoiceId || '—'}</span>
        </div>
      </header>

      <h3>Slides ({slides.length})</h3>
      {slides.map(slide => {
        const slideImages = imagesBySlide[slide.slide_number] || [];
        const slideAudio = audioBySlide[slide.slide_number] || [];
        return (
          <div key={slide.slide_number} className="slide-row">
            <h4>Slide {slide.slide_number} — {slide.slide_type}</h4>
            <div className="slide-detail">
              <strong>Narration:</strong> {describeNarration(slide.narration)}
            </div>
            <div className="slide-detail">
              <strong>Assets:</strong>
              <ul>
                {(slide.assets || []).map((a, i) => (
                  <li key={i}>{describeAsset(a)}</li>
                ))}
              </ul>
            </div>
            <div className="slide-detail">
              <strong>Materialized images ({slideImages.length}):</strong>
              <ul>
                {slideImages.map(img => (
                  <li key={img.id}>{img.cmsFilename || img.assetType || img.id}</li>
                ))}
              </ul>
            </div>
            <div className="slide-detail">
              <strong>Materialized audio ({slideAudio.length}):</strong>
              <ul>
                {slideAudio.map(a => (
                  <li key={a.id}>{a.cmsFilename || a.narrationType || a.id}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
