/**
 * Debug script to check if structuredNarration is present in RCP slides
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function check() {
  const rcpId = '4b6c8f96-bf31-4acf-91a9-2d166134924e';

  const { data, error } = await supabase
    .from('asset_lists')
    .select('slides_json')
    .eq('id', rcpId)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  const slides = data.slides_json || [];
  console.log(`Found ${slides.length} slides in slides_json\n`);

  slides.slice(0, 3).forEach((s, i) => {
    console.log(`=== Slide ${i + 1} ===`);
    console.log('slideNumber:', s.slideNumber || s.slide_number);
    console.log('slideType:', s.slideType || s.slide_type);
    console.log('has structuredNarration:', !!s.structuredNarration);
    console.log('narration (first 150 chars):', (s.narration || '').substring(0, 150));

    if (s.structuredNarration) {
      const sn = s.structuredNarration;
      console.log('--- structuredNarration contents ---');
      console.log('  question:', (sn.question || '').substring(0, 100));
      console.log('  answerChoices count:', (sn.answerChoices || []).length);
      console.log('  has correctResponseText:', !!sn.correctResponseText);
    }
    console.log('');
  });
}

check().catch(console.error);
