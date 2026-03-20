import { useState, useRef } from 'react';

/**
 * AssessmentNarrationPanel - Multi-part narration UI for assessment questions
 *
 * Displays all narration parts for a single question:
 * - Question (scenario + question text)
 * - Answer A-E (each answer choice)
 * - Correct Response
 * - First Incorrect
 * - Second Incorrect
 */
export default function AssessmentNarrationPanel({
  questionNumber,
  audioRecords = [],
  voices = [],
  defaultVoiceId,
  onGenerateAudio,
  onGenerateAll,
  onUploadAudio,
  onEditNarration,
  onSelectAudio,
  onAddNarration,
  onDeleteNarration,
  onPushToCms,
  cmsAvailable = false,
  hasCmsPageMapping = false,
  selectedAudioId,
  loading
}) {
  const [expanded, setExpanded] = useState(true);
  const fileInputRefs = useRef({});

  // Get human-readable label for narration type
  const getTypeLabel = (narrationType) => {
    const labels = {
      'slide_narration': 'Slide Narration',
      'popup_1': 'Pop Up 1',
      'popup_2': 'Pop Up 2',
      'popup_3': 'Pop Up 3',
      'scenario': 'Scenario',
      'questions': 'Questions',
      'answers': 'Answers',
      'question': 'Question',
      'answer_a': 'Answer A',
      'answer_b': 'Answer B',
      'answer_c': 'Answer C',
      'answer_d': 'Answer D',
      'answer_e': 'Answer E',
      'answer_f': 'Answer F',
      'correct_response': 'Correct Response',
      'incorrect_1': 'First Incorrect',
      'incorrect_2': 'Second Incorrect',
      // Two-part question labels
      'part_a_question': 'Part A - Question',
      'part_a_answer_a': 'Part A - Answer A',
      'part_a_answer_b': 'Part A - Answer B',
      'part_a_answer_c': 'Part A - Answer C',
      'part_a_answer_d': 'Part A - Answer D',
      'part_b_question': 'Part B - Question',
      'part_b_answer_a': 'Part B - Answer A',
      'part_b_answer_b': 'Part B - Answer B',
      'part_b_answer_c': 'Part B - Answer C',
      'part_b_answer_d': 'Part B - Answer D'
    };
    return labels[narrationType] || narrationType;
  };

  // Order of narration types for display
  const typeOrder = [
    // Regular slide narration types
    'slide_narration',
    'popup_1',
    'popup_2',
    'popup_3',
    // RCP types
    'scenario',
    'questions',
    'answers',
    // Question types
    'question',
    // Two-part question types (Part A)
    'part_a_question',
    'part_a_answer_a',
    'part_a_answer_b',
    'part_a_answer_c',
    'part_a_answer_d',
    // Two-part question types (Part B)
    'part_b_question',
    'part_b_answer_a',
    'part_b_answer_b',
    'part_b_answer_c',
    'part_b_answer_d',
    // Single select answer choices
    'answer_a',
    'answer_b',
    'answer_c',
    'answer_d',
    'answer_e',
    'answer_f',
    // Feedback responses
    'correct_response',
    'incorrect_1',
    'incorrect_2'
  ];

  // Sort and filter audio records for this question
  const sortedRecords = [...audioRecords]
    .filter(a => parseInt(a.questionNumber, 10) === parseInt(questionNumber, 10) || parseInt(a.slideNumber, 10) === parseInt(questionNumber, 10))
    .sort((a, b) => {
      const aIdx = typeOrder.indexOf(a.narrationType);
      const bIdx = typeOrder.indexOf(b.narrationType);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

  // Calculate progress
  const completedCount = sortedRecords.filter(a =>
    ['completed', 'uploaded'].includes(a.status)
  ).length;
  const totalCount = sortedRecords.length;
  const pendingCount = sortedRecords.filter(a => a.status === 'pending').length;

  // Get status badge class
  const getStatusClass = (status) => {
    const classes = {
      'pending': 'status-pending',
      'generating': 'status-generating',
      'completed': 'status-completed',
      'uploaded': 'status-uploaded',
      'failed': 'status-failed'
    };
    return classes[status] || '';
  };

  const handleFileUpload = (audioId, event) => {
    const file = event.target.files?.[0];
    if (file && onUploadAudio) {
      onUploadAudio(audioId, file);
      event.target.value = '';
    }
  };

  const handleGenerateAll = () => {
    if (onGenerateAll) {
      onGenerateAll(questionNumber);
    }
  };

  // Show empty state instead of returning null
  if (sortedRecords.length === 0) {
    return (
      <div className="assessment-narration-panel">
        <div className="narration-panel-header">
          <div className="narration-panel-header-left">
            <span className="narration-expand">{'\u25BC'}</span>
            <span className="narration-label">NARRATIONS</span>
          </div>
          <div className="narration-panel-header-right">
            <span className="narration-progress narration-empty">
              No audio records - re-import data from Carl v7
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="assessment-narration-panel">
      {/* Panel Header */}
      <div
        className="narration-panel-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="narration-panel-header-left">
          <span className="narration-expand">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="narration-label">NARRATIONS</span>
        </div>
        <div className="narration-panel-header-right">
          <span className="narration-progress">
            {completedCount}/{totalCount} complete
          </span>
          {pendingCount > 0 && (
            <button
              className="btn-generate-all"
              onClick={(e) => {
                e.stopPropagation();
                handleGenerateAll();
              }}
              disabled={loading}
            >
              GEN ALL
            </button>
          )}
          {onAddNarration && (
            <button
              className="btn-add-narration"
              onClick={(e) => {
                e.stopPropagation();
                // Pass both questionNumber and slideNumber - the parent will use the appropriate one
                onAddNarration({ questionNumber, slideNumber: questionNumber });
              }}
              disabled={loading}
              title="Add narration part"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Panel Content */}
      {expanded && (
        <div className="narration-panel-content">
          {sortedRecords.map((audio) => (
            <div
              key={audio.id}
              className={`narration-part ${selectedAudioId === audio.id ? 'selected' : ''}`}
              onClick={() => onSelectAudio && onSelectAudio(audio)}
            >
              {/* Delete Button */}
              {onDeleteNarration && (
                <button
                  className="narration-part-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNarration(audio.id);
                  }}
                  title="Delete narration"
                >
                  ×
                </button>
              )}
              {/* Part Header */}
              <div className="narration-part-header">
                <span className="narration-part-label">
                  {getTypeLabel(audio.narrationType)}
                </span>
                <span className={`narration-status ${getStatusClass(audio.status || 'pending')}`}>
                  {(audio.status || 'pending').toUpperCase()}
                </span>
              </div>

              {/* Part Text */}
              <p className="narration-part-text">
                {audio.narrationText
                  ? (audio.narrationText.length > 100
                    ? audio.narrationText.substring(0, 100) + '...'
                    : audio.narrationText)
                  : 'No text'}
              </p>

              {/* Part Actions */}
              <div className="narration-part-actions">
                {/* Voice Selector */}
                <select
                  className="narration-voice-select"
                  value={audio.voiceId || defaultVoiceId || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    const voice = voices.find(v => v.voice_id === e.target.value);
                    if (onEditNarration) {
                      onEditNarration(audio.id, {
                        voiceId: e.target.value,
                        voiceName: voice?.name || ''
                      });
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {voices.map(v => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name}
                    </option>
                  ))}
                </select>

                {/* Edit Button */}
                <button
                  className="btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onEditNarration) {
                      onEditNarration(audio.id, { editText: true });
                    }
                  }}
                >
                  EDIT
                </button>

                {/* Upload Button */}
                <input
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav"
                  style={{ display: 'none' }}
                  ref={el => fileInputRefs.current[audio.id] = el}
                  onChange={(e) => handleFileUpload(audio.id, e)}
                />
                <button
                  className="btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRefs.current[audio.id]?.click();
                  }}
                  disabled={loading}
                >
                  UPLOAD
                </button>

                {/* Generate/Regenerate Button */}
                <button
                  className="btn-primary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onGenerateAudio) {
                      onGenerateAudio(audio.id, {
                        voiceId: audio.voiceId || defaultVoiceId
                      });
                    }
                  }}
                  disabled={audio.status === 'generating' || loading}
                >
                  {audio.status === 'generating' ? 'GEN...' :
                   ['completed', 'uploaded'].includes(audio.status) ? 'REGEN' : 'GEN'}
                </button>

                {/* Play Button - shown when audio is ready */}
                {['completed', 'uploaded'].includes(audio.status) && (
                  <button
                    className="btn-preview btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectAudio) onSelectAudio(audio);
                    }}
                  >
                    PLAY
                  </button>
                )}

                {/* Push to CMS button - show for assessment audio types that are supported */}
                {onPushToCms && cmsAvailable && !['correct_response', 'incorrect_1', 'incorrect_2'].includes(audio.narrationType) && (
                  <button
                    className={`btn-push-cms btn-sm ${audio.cmsPushStatus === 'pushed' ? 'pushed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPushToCms(audio.id, 'audio');
                    }}
                    disabled={audio.cmsPushStatus === 'pushing' || !['completed', 'uploaded'].includes(audio.status)}
                    title={
                      audio.cmsPushStatus === 'pushed' ? 'Already pushed to CMS' :
                      !['completed', 'uploaded'].includes(audio.status) ? 'Audio not ready' :
                      'Push to CMS'
                    }
                  >
                    {audio.cmsPushStatus === 'pushing' ? 'Pushing...' : audio.cmsPushStatus === 'pushed' ? 'Pushed' : 'Push'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
