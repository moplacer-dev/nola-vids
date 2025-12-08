import './JobList.css';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'var(--text-secondary)' },
  processing: { label: 'Processing', color: 'var(--warning)' },
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

export default function JobList({ jobs, onDelete, onSelect, selectedJobId, onViewLibrary }) {
  if (jobs.length === 0) {
    return (
      <div className="job-list-empty">
        <p>No generation jobs yet</p>
        <span>Create your first video using the form above</span>
      </div>
    );
  }

  return (
    <div className="job-list">
      <div className="job-list-header">
        <h3 className="job-list-title">Generation Queue</h3>
        {onViewLibrary && (
          <button className="job-list-view-all" onClick={onViewLibrary}>
            View All
          </button>
        )}
      </div>
      <div className="jobs">
        {jobs.map(job => {
          const status = STATUS_CONFIG[job.status];
          return (
            <div
              key={job.id}
              className={`job-card ${selectedJobId === job.id ? 'selected' : ''}`}
              onClick={() => onSelect(job)}
            >
              <div className="job-header">
                <span className="job-type">{TYPE_LABELS[job.type] || job.type}</span>
                <span
                  className="job-status"
                  style={{ color: status.color }}
                >
                  {job.status === 'processing' && <span className="spinner" />}
                  {status.label}
                </span>
              </div>
              <p className="job-prompt">{job.params?.prompt?.slice(0, 100)}...</p>
              <div className="job-footer">
                <span className="job-time">
                  {new Date(job.createdAt).toLocaleTimeString()}
                </span>
                {job.status === 'completed' && job.videos?.length > 0 && (
                  <span className="job-videos">{job.videos.length} video(s)</span>
                )}
                <button
                  className="job-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(job.id);
                  }}
                >
                  Delete
                </button>
              </div>
              {job.error && (
                <p className="job-error">{job.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
