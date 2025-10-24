/**
 * Export OpenAPI Specification
 * Generates openapi.json and openapi.yaml for documentation and testing
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { swaggerSpec } = require('./src/api/middlewares/swagger');
const yaml = require('js-yaml');

const docsDir = path.join(__dirname, 'docs');

// Create docs directory if it doesn't exist
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

// Export JSON
const jsonPath = path.join(docsDir, 'openapi.json');
fs.writeFileSync(jsonPath, JSON.stringify(swaggerSpec, null, 2));
console.log(`✓ OpenAPI JSON exported to: ${jsonPath}`);

// Export YAML
const yamlPath = path.join(docsDir, 'openapi.yaml');
const yamlContent = yaml.dump(swaggerSpec, { lineWidth: -1 });
fs.writeFileSync(yamlPath, yamlContent);
console.log(`✓ OpenAPI YAML exported to: ${yamlPath}`);

console.log('\n📊 API Summary:');
console.log(`Title: ${swaggerSpec.info.title}`);
console.log(`Version: ${swaggerSpec.info.version}`);
console.log(`Servers: ${swaggerSpec.servers.map(s => s.url).join(', ')}`);

// Count paths
const paths = Object.keys(swaggerSpec.paths || {});
console.log(`\n📍 Endpoints: ${paths.length}`);
paths.forEach(p => {
  const methods = Object.keys(swaggerSpec.paths[p]).filter(m => m !== 'parameters');
  console.log(`  ${methods.map(m => m.toUpperCase()).join(', ')} ${p}`);
});

console.log('\n✅ Export complete!');
console.log('📚 View documentation at: http://localhost:3000/api-docs');

