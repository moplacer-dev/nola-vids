import { useEffect, useCallback, useRef } from 'react';
import './MediaViewer.css';

export default function MediaViewer({
  item,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onDownload,
  onDelete,
  onReusePrompt
}) {
  const videoRef = useRef(null);

  const isVideo = item._type === 'video';
  const isImage = item._type === 'image';

  // Get the source URL
  const getSrc = () => {
    if (isVideo) {
      return item.path;
    }
    if (isImage) {
      return `/images/${item.imagePath?.split('/').pop() || item.filename}`;
    }
    return '';
  };

  const src = getSrc();

  // Get display info
  const getTitle = () => {
    if (isVideo) {
      return item.title || item.params?.prompt?.slice(0, 60) || 'Untitled Video';
    }
    return item.cmsFilename || item.filename || 'Untitled Image';
  };

  const getPrompt = () => {
    if (isVideo) {
      return item.params?.prompt || '';
    }
    return item.modifiedPrompt || item.originalPrompt || '';
  };

  const getDate = () => {
    const date = new Date(item.created_at || item.createdAt);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowRight' && hasNext) {
      onNext();
    } else if (e.key === 'ArrowLeft' && hasPrev) {
      onPrev();
    }
  }, [onClose, onNext, onPrev, hasNext, hasPrev]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Reset video when item changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [item.id]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = src;
    if (isVideo) {
      link.download = item.title ? `${item.title}.mp4` : item.filename;
    } else {
      link.download = item.cmsFilename || item.filename || 'image.png';
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="media-viewer-overlay" onClick={handleBackdropClick}>
      <div className="media-viewer">
        {/* Close button */}
        <button className="media-viewer-close" onClick={onClose} title="Close (Esc)">
          ×
        </button>

        {/* Navigation arrows */}
        {hasPrev && (
          <button className="media-viewer-nav media-viewer-prev" onClick={onPrev} title="Previous (←)">
            ‹
          </button>
        )}
        {hasNext && (
          <button className="media-viewer-nav media-viewer-next" onClick={onNext} title="Next (→)">
            ›
          </button>
        )}

        {/* Media content */}
        <div className="media-viewer-content">
          {isVideo ? (
            <video
              ref={videoRef}
              src={src}
              controls
              autoPlay
              className="media-viewer-video"
            />
          ) : (
            <img
              src={src}
              alt={getTitle()}
              className="media-viewer-image"
            />
          )}
        </div>

        {/* Info panel */}
        <div className="media-viewer-info">
          <div className="media-viewer-header">
            <span className="media-viewer-type-badge">{isVideo ? 'VIDEO' : 'IMAGE'}</span>
            <h3 className="media-viewer-title">{getTitle()}</h3>
            <span className="media-viewer-date">{getDate()}</span>
          </div>

          {getPrompt() && (
            <div className="media-viewer-prompt">
              <span className="media-viewer-prompt-label">Prompt:</span>
              <p className="media-viewer-prompt-text">{getPrompt()}</p>
            </div>
          )}

          <div className="media-viewer-actions">
            <button className="media-viewer-btn" onClick={handleDownload}>
              <span className="btn-icon">↓</span> Download
            </button>
            {getPrompt() && onReusePrompt && (
              <button
                className="media-viewer-btn"
                onClick={() => {
                  if (isVideo) {
                    onReusePrompt(item.params?.prompt, item.params?.negativePrompt);
                  } else {
                    onReusePrompt(getPrompt());
                  }
                  onClose();
                }}
              >
                <span className="btn-icon">Aa</span> Re-use Prompt
              </button>
            )}
            {onDelete && (
              <button
                className="media-viewer-btn media-viewer-btn-danger"
                onClick={() => {
                  onDelete(item.id);
                  onClose();
                }}
              >
                <span className="btn-icon">×</span> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
