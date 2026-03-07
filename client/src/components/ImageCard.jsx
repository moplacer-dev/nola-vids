import { useState } from 'react';
import './ImageCard.css';

export default function ImageCard({
  image,
  onDeleteImage,
  onReusePrompt,
  onClick
}) {
  const [showActions, setShowActions] = useState(false);

  const imageUrl = `/images/${image.imagePath?.split('/').pop() || image.filename}`;
  const displayTitle = image.cmsFilename || image.filename || 'Untitled Image';
  const prompt = image.modifiedPrompt || image.originalPrompt || '';

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = image.cmsFilename || image.filename || 'image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="image-card"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="image-card-preview" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <img
          src={imageUrl}
          alt={displayTitle}
          loading="lazy"
        />
        <span className="image-card-type-badge">IMAGE</span>
        <div className={`image-card-buttons ${showActions ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button
            className="image-card-btn"
            onClick={handleDownload}
            title="Download"
          >
            <span className="btn-icon">↓</span>
          </button>
          {prompt && onReusePrompt && (
            <button
              className="image-card-btn"
              onClick={() => onReusePrompt(prompt)}
              title="Re-use prompt"
            >
              <span className="btn-icon">Aa</span>
            </button>
          )}
          {onDeleteImage && (
            <button
              className="image-card-btn image-card-btn-danger"
              onClick={() => onDeleteImage(image.id)}
              title="Delete"
            >
              <span className="btn-icon">x</span>
            </button>
          )}
        </div>
      </div>

      <div className="image-card-info">
        <h4 className="image-card-title" title={displayTitle}>
          {displayTitle}
        </h4>
        <div className="image-card-meta">
          <span className="image-card-date">
            {new Date(image.createdAt || image.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
