import { useState } from 'react';
import './ImageCard.css';

export default function ImageCard({
  image,
  onDeleteImage,
  onReusePrompt,
  onClick
}) {
  const [showActions, setShowActions] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Use full Supabase URL if available, fallback to local path
  const imageUrl = image.imagePath || `/images/${image.filename}`;

  // Use Supabase image transforms for optimized display (thumbnails)
  const displayUrl = (() => {
    if (imageUrl.includes('supabase.co/storage/v1/object/public/')) {
      return imageUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=80';
    }
    return imageUrl;
  })();
  const displayTitle = image.cmsFilename || image.filename || 'Untitled Image';
  const prompt = image.modifiedPrompt || image.originalPrompt || '';

  const handleDownload = () => {
    const filename = image.cmsFilename || image.filename || 'image.png';

    // Use server proxy for Supabase URLs to handle CORS
    if (imageUrl.startsWith('http') && imageUrl.includes('supabase')) {
      const proxyUrl = `/download?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(filename)}`;
      window.location.href = proxyUrl;
    } else {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div
      className="image-card"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="image-card-preview" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        {imageError ? (
          <div className="image-card-error">
            <span className="error-icon">⚠</span>
            <span>Failed to load</span>
          </div>
        ) : (
          <img
            src={displayUrl}
            alt={displayTitle}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onError={() => setImageError(true)}
          />
        )}
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
