// whatsapp-cluster/jest.config.js
module.exports = {
  projects: [
    '<rootDir>/packages/gateway/jest.config.js', // Adjust if filename is different
    '<rootDir>/packages/shard/jest.config.js',   // Adjust if using separate unit/e2e configs
    // '<rootDir>/packages/shared-lib/jest.config.js', // If adding tests there
  ],
  // Optionally collect coverage at the root
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['json', 'lcov', 'text', 'clover'],
  // Add coverage path ignore patterns if needed
  // coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/test/']
};