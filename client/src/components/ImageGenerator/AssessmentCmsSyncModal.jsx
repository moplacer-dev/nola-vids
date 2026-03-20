import { useState } from 'react';
import './CmsSyncModal.css';

export default function AssessmentCmsSyncModal({
  syncData,
  onClose,
  loading
}) {
  const [expandedMismatch, setExpandedMismatch] = useState(null);

  const { matched = [], narrationMismatches = [], cmsOnly = [], nolaOnly = [], warning } = syncData || {};

  return (
    <div className="cms-sync-overlay" onClick={onClose}>
      <div className="cms-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cms-sync-header">
          <h3>Assessment CMS Sync</h3>
          <button className="btn-close" onClick={onClose}>x</button>
        </div>

        <div className="cms-sync-body">
          {loading ? (
            <div className="loading-indicator">Loading sync data...</div>
          ) : (
            <>
              {warning && (
                <div className="sync-warning">
                  {warning}
                </div>
              )}

              {/* Matched Questions */}
              <div className="sync-section sync-matched">
                <div className="sync-section-header">
                  <span className="sync-icon matched">&#10003;</span>
                  <h4>Matched Questions ({matched.length})</h4>
                </div>
                {matched.length > 0 ? (
                  <div className="sync-slide-list matched-list">
                    {matched.map((m, idx) => (
                      <div key={m.pageId || idx} className="sync-slide-item matched-item">
                        <span className="slide-number">Q{m.nolaQuestionNumber}</span>
                        <span className="slide-title">{m.nolaTitle || m.cmsTitle || '(untitled)'}</span>
                        <span className="cms-position">CMS Q{m.cmsQuestionNumber}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No exact matches found</p>
                )}
              </div>

              {/* Narration Mismatches - informational only */}
              {narrationMismatches.length > 0 && (
                <div className="sync-section sync-mismatch">
                  <div className="sync-section-header">
                    <span className="sync-icon mismatch">!</span>
                    <h4>Partial Matches ({narrationMismatches.length})</h4>
                  </div>
                  <p className="sync-section-note">
                    These questions matched with some text differences. Page mappings have been saved.
                  </p>
                  <div className="sync-slide-list">
                    {narrationMismatches.map((mismatch) => (
                      <div key={mismatch.pageId} className="sync-slide-item mismatch-item">
                        <div className="mismatch-header">
                          <div className="sync-slide-info">
                            <span className="slide-number">Q{mismatch.nolaQuestionNumber}</span>
                            <span className="slide-title">{mismatch.nolaTitle || mismatch.cmsTitle || '(untitled)'}</span>
                            <span className="match-confidence">{mismatch.similarity}% match</span>
                          </div>
                          <div className="mismatch-actions">
                            <button
                              className="btn-expand"
                              onClick={() => setExpandedMismatch(
                                expandedMismatch === mismatch.pageId ? null : mismatch.pageId
                              )}
                            >
                              {expandedMismatch === mismatch.pageId ? 'Hide' : 'Show Diff'}
                            </button>
                          </div>
                        </div>
                        {expandedMismatch === mismatch.pageId && (
                          <div className="narration-diff">
                            <div className="diff-section diff-nola">
                              <strong>NOLA.vids:</strong>
                              <p>{mismatch.nolaQuestionNarration || '(empty)'}</p>
                            </div>
                            <div className="diff-section diff-cms">
                              <strong>CMS:</strong>
                              <p>{mismatch.cmsNarration || '(empty)'}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CMS-Only Questions */}
              <div className="sync-section sync-cms-only">
                <div className="sync-section-header">
                  <span className="sync-icon cms-only">+</span>
                  <h4>CMS-Only Questions ({cmsOnly.length})</h4>
                </div>
                {cmsOnly.length > 0 ? (
                  <div className="sync-slide-list">
                    {cmsOnly.map((q) => (
                      <div key={q.pageId} className="sync-slide-item cms-only-item">
                        <div className="sync-slide-info">
                          <span className="slide-number">CMS Q{q.questionNumber}</span>
                          <span className="slide-title">{q.title || 'Untitled'}</span>
                        </div>
                        {q.narrationText && (
                          <div className="narration-preview">
                            {q.narrationText.substring(0, 80)}...
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No CMS-only questions</p>
                )}
              </div>

              {/* NOLA.vids-Only Questions */}
              <div className="sync-section sync-nola-only">
                <div className="sync-section-header">
                  <span className="sync-icon nola-only">-</span>
                  <h4>NOLA.vids-Only Questions ({nolaOnly.length})</h4>
                </div>
                {nolaOnly.length > 0 ? (
                  <div className="sync-slide-list">
                    {nolaOnly.map((q) => (
                      <div key={q.questionNumber} className="sync-slide-item nola-only-item">
                        <div className="sync-slide-info">
                          <span className="slide-number">Q{q.questionNumber}</span>
                          <span className="slide-title">{q.title || 'Untitled'}</span>
                        </div>
                        {q.narrationText && (
                          <div className="narration-preview">
                            {q.narrationText.substring(0, 80)}...
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No NOLA.vids-only questions</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="cms-sync-footer">
          <p className="sync-footer-note">
            Page mappings are automatically saved for matched questions. You can now push audio and images to CMS.
          </p>
          <button className="btn-close-modal" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
