import { useState } from 'react';
import './FolderSidebar.css';

export default function FolderSidebar({
  folders,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  totalVideoCount
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const handleCreate = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleCreate();
    } else if (e.key === 'Escape') {
      setNewFolderName('');
      setIsCreating(false);
    }
  };

  return (
    <div className="folder-sidebar">
      <h3 className="folder-sidebar-title">Folders</h3>

      <div className="folder-list">
        <button
          className={`folder-item ${selectedFolder === null ? 'active' : ''}`}
          onClick={() => onSelectFolder(null)}
        >
          <span className="folder-item-name">All Videos</span>
          <span className="folder-item-count">{totalVideoCount}</span>
        </button>

        {folders.map(folder => (
          <div key={folder.id} className="folder-item-wrapper">
            <button
              className={`folder-item ${selectedFolder === folder.name ? 'active' : ''}`}
              onClick={() => onSelectFolder(folder.name)}
            >
              <span className="folder-item-name">{folder.name}</span>
              <span className="folder-item-count">{folder.videoCount}</span>
            </button>
            <button
              className="folder-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              title="Delete folder"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {isCreating ? (
        <div className="folder-create-form">
          <input
            type="text"
            className="folder-create-input"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!newFolderName.trim()) {
                setIsCreating(false);
              }
            }}
            placeholder="Folder name..."
            autoFocus
          />
          <button className="folder-create-btn" onClick={handleCreate}>
            Add
          </button>
        </div>
      ) : (
        <button
          className="folder-add-btn"
          onClick={() => setIsCreating(true)}
        >
          + New Folder
        </button>
      )}
    </div>
  );
}
