const { GoogleGenAI } = require('@google/genai');
const c = new GoogleGenAI({apiKey: 'test'});
console.log('Client keys:', Object.keys(c));
console.log('Operations object:', c.operations);
console.log('Operations prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(c.operations)));

// Check the models object too
console.log('\nModels object:', c.models);
console.log('Models prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(c.models)));
