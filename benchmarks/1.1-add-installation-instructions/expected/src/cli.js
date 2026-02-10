#!/usr/bin/env node

const adjectives = [
  'awesome',
  'brilliant',
  'creative',
  'dynamic',
  'elegant',
  'fantastic',
  'innovative',
  'magical'
];

const nouns = [
  'project',
  'builder',
  'creator',
  'generator',
  'maker',
  'studio',
  'workspace',
  'lab'
];

function generateName() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

console.log(generateName());
