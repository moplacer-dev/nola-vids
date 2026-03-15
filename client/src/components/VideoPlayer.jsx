import './VideoPlayer.css';

export default function VideoPlayer({ job }) {
  if (!job) {
    return (
      <div className="video-player-empty">
        <div className="empty-icon">▶</div>
        <p>Select a completed job to preview</p>
      </div>
    );
  }

  if (job.status === 'processing') {
    return (
      <div className="video-player-processing">
        <div className="processing-animation">
          <div className="pulse-ring"></div>
          <div className="pulse-ring"></div>
          <div className="processing-icon">◷</div>
        </div>
        <h3>Generating Video</h3>
        <p>This may take 1-6 minutes depending on server load</p>
        <div className="processing-details">
          <span>Prompt: {job.params?.prompt?.slice(0, 50)}...</span>
        </div>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="video-player-error">
        <div className="error-icon">!</div>
        <h3>Generation Failed</h3>
        <p>{job.error}</p>
      </div>
    );
  }

  if (job.status === 'completed' && job.videos?.length > 0) {
    return (
      <div className="video-player">
        <div className="video-container">
          {job.videos.map((video, idx) => (
            <div key={idx} className="video-item">
              <video
                controls
                autoPlay
                loop
                muted
                src={video.path}
                className="video-element"
              />
              <div className="video-actions">
                <button
                  className="download-btn"
                  onClick={() => {
                    const url = video.path;
                    const filename = video.filename;
                    // Use server proxy for Supabase URLs to handle CORS
                    if (url.startsWith('http') && url.includes('supabase')) {
                      const proxyUrl = `/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
                      window.location.href = proxyUrl;
                    } else {
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = filename;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }
                  }}
                >
                  Download MP4
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="video-info">
          <h4>Generation Details</h4>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Type</span>
              <span className="info-value">{job.type}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Created</span>
              <span className="info-value">{new Date(job.createdAt).toLocaleString()}</span>
            </div>
            {job.params?.aspectRatio && (
              <div className="info-item">
                <span className="info-label">Aspect Ratio</span>
                <span className="info-value">{job.params.aspectRatio}</span>
              </div>
            )}
            {job.params?.resolution && (
              <div className="info-item">
                <span className="info-label">Resolution</span>
                <span className="info-value">{job.params.resolution}</span>
              </div>
            )}
          </div>
          <div className="prompt-display">
            <span className="info-label">Prompt</span>
            <p>{job.params?.prompt}</p>
          </div>
          {job.params?.negativePrompt && (
            <div className="prompt-display">
              <span className="info-label">Negative Prompt</span>
              <p>{job.params.negativePrompt}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="video-player-empty">
      <div className="empty-icon">◎</div>
      <p>Waiting for video...</p>
    </div>
  );
}
