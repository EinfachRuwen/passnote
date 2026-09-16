const adjectives = [
  'amber', 'azure', 'bold', 'calm', 'dark', 'fleet', 'gold', 'icy', 'jade', 'keen',
  'lime', 'mist', 'navy', 'pale', 'quick', 'rose', 'sage', 'teal', 'wild', 'zinc',
  'brave', 'crisp', 'dusk', 'echo', 'frost', 'gleam', 'haze', 'iron', 'jest', 'keen'
];

const nouns = [
  'arch', 'bird', 'cave', 'dawn', 'echo', 'flare', 'gust', 'haze', 'iris', 'kite',
  'lake', 'moon', 'nova', 'orbit', 'pine', 'quest', 'rain', 'star', 'tide', 'wave',
  'blaze', 'cloud', 'drift', 'ember', 'flame', 'grove', 'hill', 'isle', 'jazz', 'knot'
];

export function generateSlug() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 90) + 10; // 10-99
  return `${adj}-${noun}-${num}`;
}

export function isValidSlug(slug) {
  return /^[a-z]+-[a-z]+-\d{2}$/.test(slug);
}
