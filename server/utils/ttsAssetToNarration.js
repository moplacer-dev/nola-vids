// Pure mapper: tts asset rows -> generated_audio narration records.
//
// Carl emits one tts asset row per logical narration chunk via the
// parse_slide_narration_chunks helper in carl_v7/step_16_media_asset_list/
// nola_client.py. Each tts row has shape:
//   { type: 'tts', ttsType, ttsText, ttsLabel, ttsOrder, isCorrect, partLabel? }
//
// Carl chunk_type vocabulary:
//   main_narration | answer_choice | correct_response | incorrect_response | popup_narration
//
// NOLA.vids generated_audio.narrationType vocabulary this mapper produces:
//   slide_narration | question | answer_a | answer_b | ... | correct_response |
//   incorrect_1 | incorrect_2 | ...
//   For two-part assessments: part_a_question, part_a_answer_a, part_b_question, ...
//
// popup_narration chunks are skipped because NOLA.vids does not yet support a
// popup_N narrationType. When that lands, emit `popup_${asset.ttsOrder}`.
//
// main_narration disambiguation: maps to 'question' when answer_choice siblings
// exist (or when explicitly an assessment), else 'slide_narration'. Carl's
// chunk emission groups answer_choice with main_narration for the same
// slide/question, so co-occurrence is the source-of-truth signal.

/**
 * Map tts asset rows for a single slide or question to narration records.
 *
 * @param {Array} ttsAssets - asset rows for one slide/question (any type; non-tts ignored)
 * @param {Object} [options]
 * @param {boolean} [options.isAssessment] - assessment ingest (forces main_narration -> question)
 * @param {boolean} [options.isTwoPart] - two-part assessment (prefixes question/answer_* with part_a_/part_b_)
 * @returns {Array<{narrationType: string, narrationText: string}>}
 */
function mapTtsAssetsToNarrations(ttsAssets, options = {}) {
  const { isAssessment = false, isTwoPart = false } = options;

  if (!Array.isArray(ttsAssets)) return [];

  const ttsRows = ttsAssets.filter(a => a && a.type === 'tts');
  const hasAnswerChoices = ttsRows.some(a => a.ttsType === 'answer_choice');

  const records = [];
  let incorrectCounter = 0;

  for (const asset of ttsRows) {
    const text = (asset.ttsText || '').trim();
    if (!text) continue;

    const partPrefix = (isTwoPart && asset.partLabel)
      ? `part_${String(asset.partLabel).toLowerCase()}_`
      : '';

    let narrationType = null;

    switch (asset.ttsType) {
      case 'main_narration':
        narrationType = (hasAnswerChoices || isAssessment)
          ? `${partPrefix}question`
          : 'slide_narration';
        break;

      case 'answer_choice':
        if (asset.ttsLabel) {
          narrationType = `${partPrefix}answer_${String(asset.ttsLabel).toLowerCase()}`;
        }
        break;

      case 'correct_response':
        narrationType = 'correct_response';
        break;

      case 'incorrect_response':
        incorrectCounter += 1;
        narrationType = `incorrect_${incorrectCounter}`;
        break;

      case 'popup_narration':
        // Skip until NOLA.vids supports popup_N narrationType.
        break;

      default:
        // Unknown chunk type. Skip rather than guess.
        break;
    }

    if (narrationType) {
      records.push({ narrationType, narrationText: text });
    }
  }

  return records;
}

module.exports = { mapTtsAssetsToNarrations };
