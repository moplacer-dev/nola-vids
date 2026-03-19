#!/usr/bin/env node
/**
 * Explore Directus CMS Schema
 *
 * This script discovers the actual field names and relationships
 * in the Directus CMS so we can properly query the data.
 *
 * Usage: node scripts/explore-cms-schema.js
 */

require('dotenv').config();

const API_URL = process.env.DIRECTUS_API_URL;
const API_TOKEN = process.env.DIRECTUS_API_TOKEN;
const CARL_COURSE_ID = process.env.DIRECTUS_CARL_COURSE_ID;

async function request(endpoint) {
  const url = `${API_URL}${endpoint}`;
  console.log(`\n📡 GET ${endpoint}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ ${response.status}: ${text}`);
    return null;
  }

  return response.json();
}

async function exploreSchema() {
  console.log('='.repeat(60));
  console.log('DIRECTUS CMS SCHEMA EXPLORER');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`CARL Course ID: ${CARL_COURSE_ID}`);
  console.log('='.repeat(60));

  // 1. Try to get the schema/relations if we have permission
  console.log('\n\n📋 STEP 1: Checking available collections...');
  const collections = await request('/collections');
  if (collections?.data) {
    const contentCollections = collections.data
      .filter(c => c.collection.startsWith('content_'))
      .map(c => c.collection);
    console.log('Content collections:', contentCollections);
  }

  // 2. Try to get relations
  console.log('\n\n📋 STEP 2: Checking relations...');
  const relations = await request('/relations');
  if (relations?.data) {
    const contentRelations = relations.data.filter(r =>
      r.collection?.startsWith('content_') || r.related_collection?.startsWith('content_')
    );
    console.log('Content relations:');
    contentRelations.forEach(r => {
      console.log(`  ${r.collection}.${r.field} → ${r.related_collection}`);
    });
  }

  // 3. Get the CARL course with all fields to see what's available
  console.log('\n\n📋 STEP 3: Fetching CARL course structure...');
  const course = await request(`/items/content_courses/${CARL_COURSE_ID}?fields=*`);
  if (course?.data) {
    console.log('\nCARL course fields:');
    Object.keys(course.data).forEach(key => {
      const val = course.data[key];
      const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
      console.log(`  ${key}: ${type}`);
    });

    // If child_units exists, show first item structure
    if (course.data.child_units?.length > 0) {
      console.log('\n  child_units[0] structure:');
      const firstUnit = course.data.child_units[0];
      if (typeof firstUnit === 'object') {
        Object.keys(firstUnit).forEach(k => console.log(`    ${k}: ${typeof firstUnit[k]}`));
      } else {
        console.log(`    (raw value: ${firstUnit})`);
      }
    }
  }

  // 4. Get first unit through junction with expanded content_units_id
  console.log('\n\n📋 STEP 4: Exploring unit structure through junction...');
  const courseWithUnits = await request(
    `/items/content_courses/${CARL_COURSE_ID}?fields=child_units.content_units_id.*`
  );
  if (courseWithUnits?.data?.child_units?.[0]?.content_units_id) {
    const unit = courseWithUnits.data.child_units[0].content_units_id;
    console.log('\nUnit fields:');
    Object.keys(unit).forEach(key => {
      const val = unit[key];
      const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
      console.log(`  ${key}: ${type}`);
    });
  }

  // 5. Get a single unit directly to see its full structure
  console.log('\n\n📋 STEP 5: Getting unit with all fields...');
  if (courseWithUnits?.data?.child_units?.[0]?.content_units_id?.id) {
    const unitId = courseWithUnits.data.child_units[0].content_units_id.id;
    const unit = await request(`/items/content_units/${unitId}?fields=*`);
    if (unit?.data) {
      console.log('\nFull unit fields:');
      Object.keys(unit.data).forEach(key => {
        const val = unit.data[key];
        const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
        console.log(`  ${key}: ${type}`);
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
          console.log(`    [0] keys: ${Object.keys(val[0]).join(', ')}`);
        }
      });

      // If there's a lessons-like field, explore it
      const lessonField = Object.keys(unit.data).find(k =>
        k.includes('lesson') || k.includes('child')
      );
      if (lessonField && Array.isArray(unit.data[lessonField]) && unit.data[lessonField].length > 0) {
        console.log(`\n  First item in ${lessonField}:`, unit.data[lessonField][0]);
      }
    }
  }

  // 6. Get a lesson directly
  console.log('\n\n📋 STEP 6: Exploring lesson structure...');
  const lessons = await request('/items/content_lessons?limit=1&fields=*');
  if (lessons?.data?.[0]) {
    const lesson = lessons.data[0];
    console.log('\nLesson fields:');
    Object.keys(lesson).forEach(key => {
      const val = lesson[key];
      const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
      console.log(`  ${key}: ${type}`);
    });

    // If there's a pages-like field, show it
    const pagesField = Object.keys(lesson).find(k =>
      k.includes('page') || k.includes('child')
    );
    if (pagesField) {
      console.log(`\n  Pages field name: "${pagesField}"`);
    }
  }

  // 7. Get a page directly to see all available fields
  console.log('\n\n📋 STEP 7: Exploring page structure...');
  const pages = await request('/items/content_pages?limit=1&fields=*');
  if (pages?.data?.[0]) {
    const page = pages.data[0];
    console.log('\nPage fields (these are what we need for sync):');
    Object.keys(page).forEach(key => {
      const val = page[key];
      const preview = typeof val === 'string'
        ? (val.length > 50 ? val.substring(0, 50) + '...' : val)
        : (Array.isArray(val) ? `array[${val.length}]` : typeof val);
      console.log(`  ${key}: ${preview}`);
    });
  }

  // 8. Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY - Copy these field names to cmsClient.js');
  console.log('='.repeat(60));
  console.log(`
Based on the exploration above, update cmsClient.js with the correct:
1. Junction table field for units: child_units.???
2. Lessons relationship on units: ???
3. Junction table field for pages (if any): ???
4. Page fields for sync: id, title, narration_text, slide_type, etc.
  `);
}

exploreSchema().catch(console.error);
