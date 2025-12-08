import { useState, useEffect } from 'react';
import './GenerationForm.css';

const MODES = [
  { id: 'text', label: 'Text to Video', icon: 'Aa' },
  { id: 'image', label: 'Image to Video', icon: '▣' },
  { id: 'frames', label: 'Frame Interpolation', icon: '⋮⋮' },
  { id: 'reference', label: 'Reference Guided', icon: '◎' },
  { id: 'extend', label: 'Extend Video', icon: '→|' }
];

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 (Landscape)' },
  { value: '9:16', label: '9:16 (Portrait)' }
];

const DURATIONS = [
  { value: '4', label: '4 seconds' },
  { value: '6', label: '6 seconds' },
  { value: '8', label: '8 seconds' }
];

const RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p (8s only)' }
];

export default function GenerationForm({
  onGenerate,
  templates,
  disabled,
  prefillPrompt,
  prefillVideo,
  onPrefillConsumed
}) {
  const [mode, setMode] = useState('text');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [durationSeconds, setDurationSeconds] = useState('8');
  const [resolution, setResolution] = useState('720p');
  const [files, setFiles] = useState({});
  const [prefillVideoInfo, setPrefillVideoInfo] = useState(null);

  // Handle prefill from library "Re-use" action
  useEffect(() => {
    if (prefillPrompt) {
      setPrompt(prefillPrompt.prompt || '');
      setNegativePrompt(prefillPrompt.negativePrompt || '');
      setMode('text');
      onPrefillConsumed?.();
    }
  }, [prefillPrompt, onPrefillConsumed]);

  // Handle prefill from library "Extend" action
  useEffect(() => {
    if (prefillVideo) {
      setMode('extend');
      setPrefillVideoInfo(prefillVideo);
      setPrompt('');
      onPrefillConsumed?.();
    }
  }, [prefillVideo, onPrefillConsumed]);

  const handleFileChange = (key, e) => {
    const fileList = e.target.files;
    if (key === 'referenceImages') {
      setFiles({ ...files, [key]: Array.from(fileList) });
    } else {
      setFiles({ ...files, [key]: fileList[0] });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Enforce 8s duration for 1080p resolution
    const effectiveDuration = resolution === '1080p' ? '8' : durationSeconds;

    if (mode === 'text') {
      onGenerate('text', { prompt, negativePrompt, aspectRatio, durationSeconds: effectiveDuration, resolution });
    } else {
      const formData = new FormData();
      formData.append('prompt', prompt);
      if (negativePrompt) formData.append('negativePrompt', negativePrompt);
      formData.append('aspectRatio', aspectRatio);
      formData.append('resolution', resolution);

      if (mode === 'image') {
        formData.append('durationSeconds', effectiveDuration);
        formData.append('image', files.image);
        onGenerate('image', formData);
      } else if (mode === 'frames') {
        formData.append('firstFrame', files.firstFrame);
        formData.append('lastFrame', files.lastFrame);
        onGenerate('frames', formData);
      } else if (mode === 'reference') {
        files.referenceImages?.forEach(f => formData.append('referenceImages', f));
        onGenerate('reference', formData);
      } else if (mode === 'extend') {
        if (prefillVideoInfo) {
          // Use the video from library - send as JSON, not FormData
          onGenerate('extend', {
            videoPath: prefillVideoInfo.path,
            prompt,
            negativePrompt
          });
        } else {
          setError('Please select a video from the library to extend');
          return;
        }
      }
    }
  };

  const applyTemplate = (template) => {
    setPrompt(template.prompt);
    setNegativePrompt(template.negativePrompt || '');
  };

  const applyNegativePreset = (preset) => {
    setNegativePrompt(prev => prev ? `${prev}, ${preset.value}` : preset.value);
  };

  return (
    <form className="generation-form" onSubmit={handleSubmit}>
      <div className="mode-selector">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            <span className="mode-icon">{m.icon}</span>
            <span className="mode-label">{m.label}</span>
          </button>
        ))}
      </div>

      <div className="form-section">
        <label className="form-label">
          Prompt
          <span className="label-hint">Describe your video, include audio cues in quotes</span>
        </label>
        <textarea
          className="form-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Example: A cat walks through a garden, "meow" it says softly, birds chirping in background'
          rows={8}
          required
        />
      </div>

      {templates && (
        <div className="templates-section">
          <label className="form-label">Example Templates</label>
          <div className="templates-grid">
            {templates.categories?.map(cat => (
              <div key={cat.name} className="template-category">
                <span className="category-name">{cat.name.replace('Star Academy - ', '')}</span>
                <div className="template-buttons">
                  {cat.templates.map(t => (
                    <button
                      key={t.name}
                      type="button"
                      className="template-btn"
                      onClick={() => applyTemplate(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="form-section">
        <label className="form-label">
          Negative Prompt
          <span className="label-hint">What to avoid (no negation words)</span>
        </label>
        <textarea
          className="form-textarea small"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="Example: blurry, low quality, cartoon, distorted"
          rows={2}
        />
        {templates?.negativePromptPresets && (
          <div className="preset-buttons">
            {templates.negativePromptPresets.map(p => (
              <button
                key={p.name}
                type="button"
                className="preset-btn"
                onClick={() => applyNegativePreset(p)}
              >
                + {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mode-specific file inputs */}
      {mode === 'image' && (
        <div className="form-section">
          <label className="form-label">Starting Image</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFileChange('image', e)}
            required
            className="file-input"
          />
        </div>
      )}

      {mode === 'frames' && (
        <>
          <div className="form-section">
            <label className="form-label">First Frame</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFileChange('firstFrame', e)}
              required
              className="file-input"
            />
          </div>
          <div className="form-section">
            <label className="form-label">Last Frame</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFileChange('lastFrame', e)}
              required
              className="file-input"
            />
          </div>
        </>
      )}

      {mode === 'reference' && (
        <div className="form-section">
          <label className="form-label">
            Reference Images
            <span className="label-hint">Up to 3 images for subject consistency</span>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => handleFileChange('referenceImages', e)}
            required
            className="file-input"
          />
        </div>
      )}

      {mode === 'extend' && (
        <div className="form-section">
          <label className="form-label">
            Video to Extend
            <span className="label-hint">Must be a Veo-generated video</span>
          </label>
          {prefillVideoInfo ? (
            <div className="prefill-video-preview">
              <video src={prefillVideoInfo.path} muted className="prefill-video" />
              <div className="prefill-video-info">
                <span className="prefill-video-name">
                  {prefillVideoInfo.title || prefillVideoInfo.filename}
                </span>
                <button
                  type="button"
                  className="prefill-video-clear"
                  onClick={() => setPrefillVideoInfo(null)}
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <input
              type="file"
              accept="video/mp4"
              onChange={(e) => handleFileChange('video', e)}
              required
              className="file-input"
            />
          )}
        </div>
      )}

      {/* Settings */}
      <div className="settings-row">
        <div className="form-group">
          <label className="form-label">Aspect Ratio</label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="form-select"
          >
            {ASPECT_RATIOS.map(ar => (
              <option key={ar.value} value={ar.value}>{ar.label}</option>
            ))}
          </select>
        </div>

        {(mode === 'text' || mode === 'image') && (
          <div className="form-group">
            <label className="form-label">Duration</label>
            <select
              value={resolution === '1080p' ? '8' : durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
              className="form-select"
              disabled={resolution === '1080p'}
            >
              {DURATIONS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Resolution</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="form-select"
          >
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button type="submit" className="generate-btn" disabled={disabled || !prompt}>
        {disabled ? 'Generating...' : 'Generate Video'}
      </button>
    </form>
  );
}
