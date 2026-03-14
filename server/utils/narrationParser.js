/**
 * Narration Parser Utility
 * Parses combined narration text from Carl v7 into separate parts for multi-part audio generation
 */

/**
 * Parse combined narration text into separate components for question slides
 * @param {string} narrationText - Combined narration text containing response feedback
 * @param {string} onscreenText - Onscreen text containing question and answer choices
 * @returns {Object} Parsed parts including question, answers, and response texts
 */
function parseNarrationText(narrationText, onscreenText) {
  const parts = {
    question: '',
    answers: [],  // Array of { letter, text }
    correctResponse: '',
    incorrect1: '',
    incorrect2: ''
  };

  // Normalize inputs
  const narration = (narrationText || '').trim();
  const onscreen = (onscreenText || '').trim();

  // Extract question (text before first answer choice in onscreen_text)
  // Look for patterns like "A)" or "A." or "A:"
  const answerStartMatch = onscreen.match(/\n?\s*[A-E][\).:]\s*/);
  if (answerStartMatch) {
    const firstAnswerIndex = answerStartMatch.index;
    if (firstAnswerIndex > 0) {
      parts.question = onscreen.substring(0, firstAnswerIndex).trim();
    }
  } else {
    // No answer choices found - entire onscreen text is the question
    parts.question = onscreen;
  }

  // Extract answer choices from onscreen_text
  // Format variations: "A) Text", "A. Text", "A: Text", "(A) Text"
  const answerRegex = /(?:^|\n)\s*(?:\()?([A-E])(?:\)|\.|\:)\s*([^\n]+)/gi;
  let match;
  while ((match = answerRegex.exec(onscreen)) !== null) {
    parts.answers.push({
      letter: match[1].toUpperCase(),
      text: match[2].trim()
    });
  }

  // Parse response texts from narration field
  // Multiple format patterns to handle different Carl v7 outputs

  // Pattern 1: "Correct Response Text:" / "First Incorrect Text:" / "Second Incorrect Text:"
  let correctMatch = narration.match(/Correct Response(?: Text)?:\s*(.+?)(?=(?:First Incorrect|1st Incorrect|Second Incorrect|2nd Incorrect|$))/si);
  let incorrect1Match = narration.match(/(?:First|1st) Incorrect(?: Text)?:\s*(.+?)(?=(?:Second Incorrect|2nd Incorrect|$))/si);
  let incorrect2Match = narration.match(/(?:Second|2nd) Incorrect(?: Text)?:\s*(.+?)$/si);

  // Pattern 2: "Correct:", "Incorrect 1:", "Incorrect 2:"
  if (!correctMatch) {
    correctMatch = narration.match(/Correct:\s*(.+?)(?=(?:Incorrect|$))/si);
  }
  if (!incorrect1Match) {
    incorrect1Match = narration.match(/Incorrect\s*1:\s*(.+?)(?=(?:Incorrect\s*2|$))/si);
  }
  if (!incorrect2Match) {
    incorrect2Match = narration.match(/Incorrect\s*2:\s*(.+?)$/si);
  }

  // Pattern 3: Numbered responses "1." "2." "3."
  if (!correctMatch && !incorrect1Match) {
    const numbered = narration.match(/1\.\s*(.+?)(?=2\.|$)/si);
    if (numbered) correctMatch = numbered;
    const numbered2 = narration.match(/2\.\s*(.+?)(?=3\.|$)/si);
    if (numbered2) incorrect1Match = numbered2;
    const numbered3 = narration.match(/3\.\s*(.+?)$/si);
    if (numbered3) incorrect2Match = numbered3;
  }

  if (correctMatch) parts.correctResponse = cleanResponseText(correctMatch[1]);
  if (incorrect1Match) parts.incorrect1 = cleanResponseText(incorrect1Match[1]);
  if (incorrect2Match) parts.incorrect2 = cleanResponseText(incorrect2Match[1]);

  return parts;
}

/**
 * Clean up response text by removing extra whitespace and common artifacts
 * @param {string} text - Raw response text
 * @returns {string} Cleaned text
 */
function cleanResponseText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/^\s*[-–—]\s*/, '')  // Remove leading dashes
    .replace(/\s*[-–—]\s*$/, '');  // Remove trailing dashes
}

/**
 * Detect if a slide is a question slide (has answer choices)
 * @param {string} onscreenText - The onscreen text to check
 * @param {string} slideType - Optional slide type from Carl v7
 * @returns {boolean} True if this appears to be a question slide
 */
function isQuestionSlide(onscreenText, slideType) {
  // Check slideType first if available
  if (slideType) {
    const typeLower = slideType.toLowerCase();
    if (typeLower.includes('question') ||
        typeLower.includes('quiz') ||
        typeLower.includes('rcp_recall') ||
        typeLower.includes('rcp_connect') ||
        typeLower.includes('rcp_practice') ||
        typeLower.includes('rcp_apply') ||
        typeLower.includes('assessment')) {
      return true;
    }
  }

  // Check for answer choice pattern in onscreen text
  if (!onscreenText) return false;

  // Multiple answer patterns: A) B) C) or A. B. C. or (A) (B) (C)
  const hasAnswerChoices = /(?:^|\n)\s*(?:\()?[A-E][\).:\s]/m.test(onscreenText);

  // Must have at least 2 answer choices to be a question
  const answerCount = (onscreenText.match(/(?:^|\n)\s*(?:\()?[A-E][\).:\s]/gm) || []).length;

  return hasAnswerChoices && answerCount >= 2;
}

/**
 * Get the narration type code for CMS filenames
 * @param {string} narrationType - Internal narration type
 * @returns {string} CMS-compatible type code
 */
function narrationTypeToCode(narrationType) {
  const typeMap = {
    'slide_narration': 'NAR1',
    'question': 'QUESTION',
    'answer_a': 'ANS_A',
    'answer_b': 'ANS_B',
    'answer_c': 'ANS_C',
    'answer_d': 'ANS_D',
    'answer_e': 'ANS_E',
    'correct_response': 'CORRECT',
    'incorrect_1': 'INCOR1',
    'incorrect_2': 'INCOR2',
    // Two-part question types
    'part_a_question': 'PA_Q',
    'part_a_answer_a': 'PA_A',
    'part_a_answer_b': 'PA_B',
    'part_a_answer_c': 'PA_C',
    'part_a_answer_d': 'PA_D',
    'part_b_question': 'PB_Q',
    'part_b_answer_a': 'PB_A',
    'part_b_answer_b': 'PB_B',
    'part_b_answer_c': 'PB_C',
    'part_b_answer_d': 'PB_D'
  };
  return typeMap[narrationType] || 'NAR1';
}

/**
 * Get human-readable label for narration type
 * @param {string} narrationType - Internal narration type
 * @returns {string} Human-readable label
 */
function getNarrationTypeLabel(narrationType) {
  const labelMap = {
    'slide_narration': 'Narration',
    'question': 'Question',
    'answer_a': 'Answer A',
    'answer_b': 'Answer B',
    'answer_c': 'Answer C',
    'answer_d': 'Answer D',
    'answer_e': 'Answer E',
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
  return labelMap[narrationType] || narrationType;
}

/**
 * Get all possible narration types for a question
 * @returns {string[]} Array of narration types
 */
function getQuestionNarrationTypes() {
  return [
    'question',
    'answer_a',
    'answer_b',
    'answer_c',
    'answer_d',
    'answer_e',
    'correct_response',
    'incorrect_1',
    'incorrect_2'
  ];
}

/**
 * Get all possible narration types for a two-part question
 * @returns {string[]} Array of narration types
 */
function getTwoPartQuestionNarrationTypes() {
  return [
    'part_a_question',
    'part_a_answer_a',
    'part_a_answer_b',
    'part_a_answer_c',
    'part_a_answer_d',
    'part_b_question',
    'part_b_answer_a',
    'part_b_answer_b',
    'part_b_answer_c',
    'part_b_answer_d',
    'correct_response',
    'incorrect_1',
    'incorrect_2'
  ];
}

module.exports = {
  parseNarrationText,
  isQuestionSlide,
  narrationTypeToCode,
  getNarrationTypeLabel,
  getQuestionNarrationTypes,
  getTwoPartQuestionNarrationTypes,
  cleanResponseText
};
