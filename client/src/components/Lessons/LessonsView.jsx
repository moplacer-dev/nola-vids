import { useState } from 'react';
import LessonView from './LessonView';

export default function LessonsView({ getLessonsByModule, getLesson }) {
  const [moduleInput, setModuleInput] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedLessonId, setSelectedLessonId] = useState(null);

  const loadLessons = async (name) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLessonsByModule(name);
      setLessons(result.lessons || []);
    } catch (err) {
      setError(err.message || String(err));
      setLessons([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const trimmed = moduleInput.trim();
    if (!trimmed) return;
    setModuleName(trimmed);
    setSelectedLessonId(null);
    loadLessons(trimmed);
  };

  if (selectedLessonId) {
    return (
      <LessonView
        lessonId={selectedLessonId}
        getLesson={getLesson}
        onBack={() => setSelectedLessonId(null)}
      />
    );
  }

  return (
    <div className="lessons-view">
      <form onSubmit={handleSearch} className="lessons-search">
        <label htmlFor="lessons-module-input">Module name</label>
        <input
          id="lessons-module-input"
          type="text"
          value={moduleInput}
          onChange={(e) => setModuleInput(e.target.value)}
          placeholder="e.g. Heat and Energy"
        />
        <button type="submit" disabled={loading || !moduleInput.trim()}>
          {loading ? 'Loading...' : 'Load Lessons'}
        </button>
      </form>

      {error && <div className="lesson-error">{error}</div>}

      {moduleName && !loading && lessons.length === 0 && !error && (
        <div className="lessons-empty">No lessons found for "{moduleName}".</div>
      )}

      {lessons.length > 0 && (
        <ul className="lessons-list">
          {lessons.map(lesson => (
            <li key={lesson.id} className="lessons-list-item">
              <button
                type="button"
                className="lessons-list-link"
                onClick={() => setSelectedLessonId(lesson.id)}
              >
                <span className="lessons-list-label">{lesson.lessonLabel}</span>
                <span className="lessons-list-type">{lesson.lessonType}</span>
                <span className="lessons-list-schema">v{lesson.schemaVersion}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
