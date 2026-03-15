import './JobList.css';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'var(--text-secondary)' },
  processing: { label: 'Processing', color: 'var(--warning)' },
  queued: { label: 'Queued', color: 'var(--text-secondary)' },
  completed: { label: 'Completed', color: 'var(--success)' },
  failed: { label: 'Failed', color: 'var(--error)' }
};

const TYPE_LABELS = {
  'text-to-video': 'Text to Video',
  'image-to-video': 'Image to Video',
  'frame-interpolation': 'Frame Interpolation',
  'reference-guided': 'Reference Guided',
  'video-extension': 'Video Extension'
};

export default function JobList({
  jobs,
  completedVideos = [],
  onDeleteJob,
  onDeleteVideo,
  onSelect,
  selectedId,
  onReusePrompt,
  onExtendVideo
}) {
  // Combine active jobs with completed videos from library
  // Active jobs (pending, processing, queued) show at top
  // Completed videos from database show below
  const activeJobs = jobs.filter(j => j.status !== 'completed');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  // Convert completed videos to a unified format for display
  const libraryVideos = completedVideos.map(video => ({
    id: video.id,
    type: video.jobType || 'text-to-video',
    status: 'completed',
    params: video.params,
    videos: [video],
    createdAt: video.createdAt,
    isLibraryVideo: true
  }));

  // Filter out library videos that already have corresponding completed jobs
  const completedJobIds = new Set(completedJobs.map(j => j.videos?.[0]?.id).filter(Boolean));
  const uniqueLibraryVideos = libraryVideos.filter(v => !completedJobIds.has(v.id));

  const allItems = [...activeJobs, ...completedJobs, ...uniqueLibraryVideos];

  if (allItems.length === 0) {
    return (
      <div className="job-list-empty">
        <p>No generation jobs yet</p>
        <span>Create your first video using the form above</span>
      </div>
    );
  }

  const handleDelete = (item, e) => {
    e.stopPropagation();
    if (item.isLibraryVideo) {
      onDeleteVideo?.(item.id);
    } else {
      onDeleteJob?.(item.id);
    }
  };

  return (
    <div className="job-list">
      <div className="job-list-header">
        <h3 className="job-list-title">Generation Queue</h3>
      </div>
      <div className="jobs">
        {allItems.map(item => {
          const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.completed;
          const isSelected = selectedId === item.id || selectedId === item.videos?.[0]?.id;

          return (
            <div
              key={item.id}
              className={`job-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(item)}
            >
              <div className="job-header">
                <span className="job-type">{TYPE_LABELS[item.type] || item.type}</span>
                <span
                  className="job-status"
                  style={{ color: status.color }}
                >
                  {(item.status === 'processing' || item.status === 'queued') && <span className="spinner" />}
                  {status.label}
                </span>
                <button
                  className="job-delete"
                  onClick={(e) => handleDelete(item, e)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
              <p className="job-prompt">{item.params?.prompt || 'Imported video'}</p>
              {item.error && (
                <p className="job-error">{item.error}</p>
              )}
              {item.status === 'completed' && (onReusePrompt || onExtendVideo) && (
                <div className="job-actions">
                  {onReusePrompt && item.params?.prompt && (
                    <button
                      className="job-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReusePrompt(item.params.prompt, item.params.negativePrompt);
                      }}
                      title="Reuse Prompt"
                    >
                      Reuse
                    </button>
                  )}
                  {onExtendVideo && item.videos?.[0] && (
                    <button
                      className="job-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExtendVideo(item.videos[0]);
                      }}
                      title="Extend Video"
                    >
                      Extend
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
