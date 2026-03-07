import { useState, useRef } from 'react';
import './VideoCard.css';

export default function VideoCard({
  video,
  folders,
  onUpdateVideo,
  onDeleteVideo,
  onReusePrompt,
  onExtendVideo,
  onClick
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(video.title || '');
  const [showActions, setShowActions] = useState(false);
  const videoRef = useRef(null);

  const handleMouseEnter = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const handleTitleSave = () => {
    if (editTitle.trim() !== (video.title || '')) {
      onUpdateVideo(video.id, { title: editTitle.trim() || null });
    }
    setIsEditing(false);
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setEditTitle(video.title || '');
      setIsEditing(false);
    }
  };

  const handleFolderChange = (e) => {
    const folder = e.target.value || null;
    onUpdateVideo(video.id, { folder });
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = video.path;
    link.download = video.title ? `${video.title}.mp4` : video.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const prompt = video.params?.prompt || '';
  const negativePrompt = video.params?.negativePrompt || '';
  const displayTitle = video.title || prompt.slice(0, 40) + (prompt.length > 40 ? '...' : '');

  return (
    <div
      className="video-card"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className="video-card-preview"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        <video
          ref={videoRef}
          src={video.path}
          muted
          loop
          playsInline
          preload="auto"
        />
        {video.folder && (
          <span className="video-card-folder-badge">{video.folder}</span>
        )}
        <div className={`video-card-buttons ${showActions ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button
            className="video-card-btn"
            onClick={handleDownload}
            title="Download"
          >
            <span className="btn-icon">↓</span>
          </button>
          <button
            className="video-card-btn"
            onClick={() => onReusePrompt(prompt, negativePrompt)}
            title="Re-use prompt"
          >
            <span className="btn-icon">Aa</span>
          </button>
          <button
            className="video-card-btn"
            onClick={() => onExtendVideo(video)}
            title="Extend video"
          >
            <span className="btn-icon">→|</span>
          </button>
          <button
            className="video-card-btn video-card-btn-danger"
            onClick={() => onDeleteVideo(video.id)}
            title="Delete"
          >
            <span className="btn-icon">×</span>
          </button>
        </div>
      </div>

      <div className="video-card-info">
        {isEditing ? (
          <input
            type="text"
            className="video-card-title-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            placeholder="Enter title..."
          />
        ) : (
          <h4
            className="video-card-title"
            onClick={() => setIsEditing(true)}
            title="Click to edit title"
          >
            {displayTitle}
          </h4>
        )}

        <div className="video-card-meta">
          <span className="video-card-date">
            {new Date(video.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
          {folders.length > 0 && (
            <select
              className="video-card-folder-select"
              value={video.folder || ''}
              onChange={handleFolderChange}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No folder</option>
              {folders.map(f => (
                <option key={f.id} value={f.name}>{f.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
