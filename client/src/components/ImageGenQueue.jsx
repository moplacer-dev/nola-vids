import './ImageGenQueue.css';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'var(--text-secondary)' },
  generating: { label: 'Generating', color: 'var(--warning)' },
  completed: { label: 'Completed', color: 'var(--success)' },
  failed: { label: 'Failed', color: 'var(--error)' }
};

export default function ImageGenQueue({
  images = [],
  selectedId,
  onSelect,
  onDelete,
  onReusePrompt
}) {
  if (images.length === 0) {
    return (
      <div className="image-gen-queue-empty">
        <p>No generated images yet</p>
        <span>Create your first image using the form above</span>
      </div>
    );
  }

  return (
    <div className="image-gen-queue">
      <div className="image-gen-queue-header">
        <h3 className="image-gen-queue-title">Generation Queue</h3>
      </div>
      <div className="image-gen-queue-items">
        {images.map(image => {
          const status = STATUS_CONFIG[image.status] || STATUS_CONFIG.completed;
          const prompt = image.modifiedPrompt || image.originalPrompt || 'No prompt';

          return (
            <div
              key={image.id}
              className={`image-gen-queue-card ${selectedId === image.id ? 'selected' : ''}`}
              onClick={() => onSelect?.(image)}
            >
              <div className="image-gen-queue-card-header">
                <span className="image-gen-queue-type">Text to Image</span>
                <span
                  className="image-gen-queue-status"
                  style={{ color: status.color }}
                >
                  {image.status === 'generating' && <span className="spinner" />}
                  {status.label}
                </span>
                <button
                  className="image-gen-queue-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(image.id);
                  }}
                  title="Delete image"
                >
                  ✕
                </button>
              </div>
              <p className="image-gen-queue-prompt">{prompt}</p>
              {image.status === 'completed' && onReusePrompt && prompt && (
                <div className="image-gen-queue-actions">
                  <button
                    className="image-gen-queue-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReusePrompt(prompt);
                    }}
                    title="Reuse Prompt"
                  >
                    Reuse
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
