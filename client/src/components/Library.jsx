import { useState, useEffect, useCallback } from 'react';
import VideoCard from './VideoCard';
import FolderSidebar from './FolderSidebar';
import './Library.css';

export default function Library({
  accessKey,
  getLibrary,
  getFolders,
  createFolder,
  deleteFolder,
  updateVideo,
  deleteVideo,
  onReusePrompt,
  onExtendVideo
}) {
  const [videos, setVideos] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [loading, setLoading] = useState(true);

  const loadVideos = useCallback(async () => {
    try {
      const data = await getLibrary({
        folder: selectedFolder,
        search: searchQuery || undefined
      });

      // Sort client-side
      const sorted = [...data].sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
      });

      setVideos(sorted);
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  }, [getLibrary, selectedFolder, searchQuery, sortOrder]);

  const loadFolders = useCallback(async () => {
    try {
      const data = await getFolders();
      setFolders(data);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, [getFolders]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadVideos(), loadFolders()]);
      setLoading(false);
    };
    load();
  }, [loadVideos, loadFolders]);

  const handleCreateFolder = async (name) => {
    try {
      await createFolder(name);
      await loadFolders();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleDeleteFolder = async (folderId) => {
    try {
      await deleteFolder(folderId);
      if (folders.find(f => f.id === folderId)?.name === selectedFolder) {
        setSelectedFolder(null);
      }
      await Promise.all([loadFolders(), loadVideos()]);
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleUpdateVideo = async (videoId, updates) => {
    try {
      await updateVideo(videoId, updates);
      await Promise.all([loadVideos(), loadFolders()]);
    } catch (err) {
      console.error('Failed to update video:', err);
    }
  };

  const handleDeleteVideo = async (videoId) => {
    try {
      await deleteVideo(videoId);
      await Promise.all([loadVideos(), loadFolders()]);
    } catch (err) {
      console.error('Failed to delete video:', err);
    }
  };

  const totalVideoCount = videos.length + (selectedFolder ?
    folders.reduce((acc, f) => f.name !== selectedFolder ? acc + f.videoCount : acc, 0) : 0);

  // Calculate actual total for "All Videos"
  const allVideosCount = folders.reduce((acc, f) => acc + f.videoCount, 0) +
    videos.filter(v => !v.folder).length;

  return (
    <div className="library">
      <div className="library-header">
        <h2 className="library-title">Video Library</h2>
        <div className="library-controls">
          <input
            type="text"
            className="library-search"
            placeholder="Search by title or prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="library-sort"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      <div className="library-content">
        <FolderSidebar
          folders={folders}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          totalVideoCount={allVideosCount}
        />

        <div className="library-grid-container">
          {loading ? (
            <div className="library-loading">
              <span className="spinner" />
              <p>Loading videos...</p>
            </div>
          ) : videos.length === 0 ? (
            <div className="library-empty">
              <p>No videos found</p>
              <span>
                {selectedFolder
                  ? `No videos in "${selectedFolder}" folder`
                  : searchQuery
                    ? 'Try a different search term'
                    : 'Generate some videos to see them here'}
              </span>
            </div>
          ) : (
            <div className="library-grid">
              {videos.map(video => (
                <VideoCard
                  key={video.id}
                  video={video}
                  folders={folders}
                  onUpdateVideo={handleUpdateVideo}
                  onDeleteVideo={handleDeleteVideo}
                  onReusePrompt={onReusePrompt}
                  onExtendVideo={onExtendVideo}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
