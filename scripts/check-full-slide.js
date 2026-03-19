/**
 * Debug: Compare slide data with audio record to find the bug
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function check() {
  const rcpId = '4b6c8f96-bf31-4acf-91a9-2d166134924e';

  // Get slides_json
  const { data: assetList } = await supabase
    .from('asset_lists')
    .select('slides_json')
    .eq('id', rcpId)
    .single();

  const slide1 = assetList.slides_json[0];

  console.log('=== SLIDE 1 FULL DATA ===');
  console.log('Keys:', Object.keys(slide1));
  console.log('\nnarration field (full):');
  console.log(slide1.narration);
  console.log('\nnarrationText field:', slide1.narrationText);
  console.log('\n--- structuredNarration ---');
  console.log(JSON.stringify(slide1.structuredNarration, null, 2));

  // Get the audio record
  console.log('\n=== AUDIO RECORD FOR SLIDE 1 (question type) ===');
  const { data: audio } = await supabase
    .from('generated_audio')
    .select('*')
    .eq('asset_list_id', rcpId)
    .eq('slide_number', 1)
    .eq('narration_type', 'question')
    .single();

  console.log('narration_text from DB:');
  console.log(audio?.narration_text);

  // Check if they match
  console.log('\n=== COMPARISON ===');
  console.log('structuredNarration.question:', slide1.structuredNarration?.question);
  console.log('audio.narration_text matches structuredNarration.question:',
    audio?.narration_text === slide1.structuredNarration?.question);
  console.log('audio.narration_text matches slide.narration:',
    audio?.narration_text === slide1.narration);
}

check().catch(console.error);
